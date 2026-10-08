/**
 * End-to-end check of the patient journey against a RUNNING API (default http://localhost:3000).
 *   npm run test:workflow
 * Creates its own test patients and deletes them at the end. Exits non-zero if any step fails.
 * Env: API_URL, SEED_USER_PASSWORD (read from .env by `npm run test:workflow`).
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.SEED_USER_PASSWORD;
let failed = 0;
const tokens = {};

const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok ? '' : `  → ${detail}`}`);
};

async function call(role, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const vitals = (patientId, extra = {}) => ({
  patientId,
  heartRate: 80,
  bpSystolic: 120,
  spO2: 98,
  tempCelsius: 36.8,
  respiratoryRate: 16,
  consciousness: 'ALERT',
  onSupplementalO2: false,
  ...extra,
});

async function main() {
  if (!PASSWORD) throw new Error('SEED_USER_PASSWORD is not set');
  for (const u of ['receptionist', 'nurse', 'doctor', 'admin']) {
    const r = await call(null, 'POST', '/auth/login', { username: u, password: PASSWORD });
    tokens[u] = r.body.accessToken ?? r.body.access_token ?? r.body.token;
    if (!tokens[u]) throw new Error(`login failed for ${u}: ${JSON.stringify(r.body)}`);
  }
  const stamp = Date.now().toString().slice(-6);
  const name = `Flow Test ${stamp}`;
  const phone = `+1 555 ${stamp.slice(0, 3)} ${stamp.slice(3)}9`;
  const created = [];

  console.log('\n▶ Reception: register a new patient (opens the first visit)');
  const reg = await call('receptionist', 'POST', '/hospital/lifecycle/register-op', {
    name, age: 40, gender: 'female', phone, bloodType: 'O+', chiefComplaint: 'fever and cough',
  });
  check('registration succeeds (201)', reg.status === 201, JSON.stringify(reg.body).slice(0, 200));
  const pid = reg.body.patientId;
  created.push(pid);
  const v1 = reg.body.visit;
  check('first visit is WAITING_TRIAGE', v1?.status === 'WAITING_TRIAGE', JSON.stringify(v1));

  console.log('\n▶ Reception: duplicate protection');
  const dup = await call('receptionist', 'POST', '/hospital/lifecycle/register-op', {
    name, age: 40, gender: 'female', phone, bloodType: 'O+',
  });
  check('same name + phone is refused with possibleMatches (409)', dup.status === 409 && dup.body.possibleMatches?.[0]?.patientId === pid, JSON.stringify(dup.body).slice(0, 200));
  const forced = await call('receptionist', 'POST', '/hospital/lifecycle/register-op', {
    name, age: 40, gender: 'female', phone, bloodType: 'O+', allowDuplicate: true,
  });
  check('allowDuplicate registers a second person', forced.status === 201, JSON.stringify(forced.body).slice(0, 200));
  if (forced.body.patientId) created.push(forced.body.patientId);

  console.log('\n▶ One open visit per patient');
  const second = await call('receptionist', 'POST', `/hospital/patients/${pid}/visits`, { chiefComplaint: 'again' });
  check('starting another visit while one is open is refused (409)', second.status === 409 && second.body.openVisitId === v1.id, JSON.stringify(second.body).slice(0, 200));

  console.log('\n▶ Reception cannot do clinical work');
  const recTriage = await call('receptionist', 'POST', '/hospital/lifecycle/triage', vitals(pid));
  check('receptionist cannot triage (403)', recTriage.status === 403, String(recTriage.status));

  console.log('\n▶ Nurse: triage');
  const tri = await call('nurse', 'POST', '/hospital/lifecycle/triage', vitals(pid, { heartRate: 112, tempCelsius: 38.9, symptoms: ['fever', 'cough'], glucoseMgDl: 110 }));
  check('triage succeeds', tri.status === 201, JSON.stringify(tri.body).slice(0, 200));
  check('visit moved to TRIAGED with a priority', tri.body.visit?.status === 'TRIAGED' && tri.body.visit?.priority >= 1, JSON.stringify(tri.body.visit));

  console.log('\n▶ Doctor: consultation moves the visit into consultation');
  const con = await call('doctor', 'POST', '/hospital/lifecycle/record-consultation', {
    patientId: pid, diagnosis: 'Acute bronchitis', prescriptions: ['Paracetamol 500mg'], notes: 'Rest and fluids.',
  });
  check('consultation saved', con.status === 201, JSON.stringify(con.body).slice(0, 200));
  check('visit is IN_CONSULTATION with the doctor recorded', con.body.visit?.status === 'IN_CONSULTATION' && !!con.body.visit?.primaryDoctorName, JSON.stringify(con.body.visit));

  console.log('\n▶ Transition rules');
  const bad = await call('doctor', 'POST', `/hospital/visits/${v1.id}/transition`, { to: 'WAITING_TRIAGE' });
  check('an impossible move is refused (409)', bad.status === 409, String(bad.status));
  const wrongRole = await call('nurse', 'POST', `/hospital/visits/${v1.id}/transition`, { to: 'COMPLETED' });
  check('a role that may not complete is refused (403)', wrongRole.status === 403, String(wrongRole.status));
  const detail = await call('doctor', 'GET', `/hospital/visits/${v1.id}`);
  check('detail lists allowed transitions and a timeline', detail.body.allowedTransitions?.length > 0 && detail.body.timeline?.length >= 3, JSON.stringify(detail.body).slice(0, 200));

  console.log('\n▶ Complete the visit');
  const done = await call('doctor', 'POST', `/hospital/visits/${v1.id}/transition`, { to: 'COMPLETED' });
  check('doctor completes the visit', done.status === 201 && done.body.visit?.status === 'COMPLETED', JSON.stringify(done.body).slice(0, 200));
  const lab = await call('nurse', 'POST', '/hospital/lifecycle/lab-result', { patientId: pid, testName: 'CRP', value: '5', unit: 'mg/L' });
  check('clinical writes are refused once the visit is completed (409)', lab.status === 409, String(lab.status));
  const noNote = await call('doctor', 'POST', `/hospital/visits/${v1.id}/transition`, { to: 'IN_CONSULTATION' });
  check('reopening without a reason is refused (400)', noNote.status === 400, String(noNote.status));
  const reopen = await call('doctor', 'POST', `/hospital/visits/${v1.id}/transition`, { to: 'IN_CONSULTATION', note: 'result review' });
  check('reopening with a reason works', reopen.body.visit?.status === 'IN_CONSULTATION', JSON.stringify(reopen.body).slice(0, 200));
  await call('doctor', 'POST', `/hospital/visits/${v1.id}/transition`, { to: 'COMPLETED' });

  console.log('\n▶ Returning patient: a new visit; history is kept');
  const v2 = await call('receptionist', 'POST', `/hospital/patients/${pid}/visits`, { chiefComplaint: 'follow-up' });
  check('new visit opens for the returning patient', v2.status === 201 && v2.body.visit?.status === 'WAITING_TRIAGE', JSON.stringify(v2.body).slice(0, 200));
  const hist = await call('doctor', 'GET', `/hospital/patients/${pid}/visits`);
  check('both visits are listed', Array.isArray(hist.body) && hist.body.length === 2, JSON.stringify(hist.body).slice(0, 200));
  const list = await call('doctor', 'GET', `/hospital/patients?q=${encodeURIComponent(name)}&stage=WAITING`);
  check('patient list shows the current visit status', list.body.items?.some((p) => p.id === pid && p.visit?.status === 'WAITING_TRIAGE'), JSON.stringify(list.body).slice(0, 200));
  const ov = await call('doctor', 'GET', '/hospital/overview');
  check('overview counts waiting-for-triage', ov.body.waitingForTriage >= 1, JSON.stringify(ov.body).slice(0, 200));

  console.log('\n▶ Cancel needs a reason');
  const vid2 = v2.body.visit.id;
  const c1 = await call('receptionist', 'POST', `/hospital/visits/${vid2}/transition`, { to: 'CANCELLED' });
  check('cancel without a reason is refused (400)', c1.status === 400, String(c1.status));
  const c2 = await call('receptionist', 'POST', `/hospital/visits/${vid2}/transition`, { to: 'CANCELLED', note: 'patient went home' });
  check('cancel with a reason works', c2.body.visit?.status === 'CANCELLED', JSON.stringify(c2.body).slice(0, 200));

  console.log('\n▶ Cleanup: admin deletes the test patients');
  for (const id of created) {
    const del = await call('admin', 'DELETE', `/hospital/patients/${id}?confirm=${id}`);
    check(`delete ${id}`, del.body.success === true && del.body.deleted?.visits >= 1, JSON.stringify(del.body).slice(0, 200));
  }
}

main()
  .catch((e) => {
    failed++;
    console.error('FATAL', e.message);
  })
  .finally(() => {
    console.log(failed ? `\n❌ ${failed} check(s) failed` : '\n✅ all workflow checks passed');
    process.exit(failed ? 1 : 0);
  });
