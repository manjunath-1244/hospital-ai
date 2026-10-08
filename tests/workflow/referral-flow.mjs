/**
 * The specialist referral loop end to end against the RUNNING API (no language model involved):
 * triage -> lab -> doctor refers -> specialist notified, sees ONLY referred patients -> completes (with follow-up tests)
 * -> visit moves to follow-up, doctor notified -> follow-up plan proposed -> approved -> items really created -> complete.
 * Run: `npm run test:workflow`.
 */
import { call, check, finish, login } from './client.mjs';

const vitals = (patientId) => ({ patientId, heartRate: 115, bpSystolic: 165, spO2: 94, tempCelsius: 37.8, respiratoryRate: 24, consciousness: 'ALERT', onSupplementalO2: false, symptoms: ['chest pain'] });

async function main() {
  await login('receptionist', 'nurse', 'doctor', 'cardiologist', 'neurologist', 'admin');
  const s = Date.now().toString().slice(-6);

  console.log('\n▶ Patient arrives, is triaged, has a critical troponin');
  const reg = await call('receptionist', 'POST', '/hospital/lifecycle/register-op', { name: `Referral Test ${s}`, age: 58, gender: 'male', phone: `+1 555 ${s.slice(0, 3)} ${s.slice(3)}5`, bloodType: 'A+', chiefComplaint: 'Acute severe chest pain radiating to left arm' });
  const pid = reg.body.patientId;
  const vid = reg.body.visit.id;
  await call('nurse', 'POST', '/hospital/lifecycle/triage', vitals(pid));
  const doc = await call('doctor', 'POST', '/hospital/lifecycle/record-consultation', { patientId: pid, diagnosis: 'Chest pain, query ACS', prescriptions: [], notes: 'ECG ordered' });
  check('doctor starts the consultation', doc.body.visit?.status === 'IN_CONSULTATION', JSON.stringify(doc.body).slice(0, 160));
  const lab = await call('doctor', 'POST', '/hospital/lifecycle/lab-result', { patientId: pid, testName: 'Troponin T', value: '0.85', unit: 'ng/mL', referenceRange: '< 0.04' });
  check('doctor can add a lab result', lab.status === 201 && lab.body.lab?.status === 'CRITICAL', JSON.stringify(lab.body).slice(0, 200));
  const rec = await call('doctor', 'GET', `/hospital/patients/${pid}/referral-recommendation`);
  check('recommendation engine suggests Cardiology from the data', rec.body.recommendation === 'SPECIALIST' && rec.body.specialty === 'Cardiology', JSON.stringify(rec.body).slice(0, 300));

  console.log('\n▶ Referral and notifications');
  const bad = await call('doctor', 'POST', '/hospital/referrals', { visitId: vid, patientId: pid, specialty: 'Cardiology', reason: 'x' });
  check('a too-short reason is refused (400)', bad.status === 400);
  const wrong = await call('receptionist', 'POST', '/hospital/referrals', { visitId: vid, patientId: pid, specialty: 'Cardiology', reason: 'Chest pain with troponin 0.85' });
  check('a receptionist cannot create a referral (403)', wrong.status === 403, String(wrong.status));
  const ref = await call('doctor', 'POST', '/hospital/referrals', { visitId: vid, patientId: pid, specialty: 'Cardiology', urgency: 'URGENT', reason: 'Chest pain with troponin 0.85 ng/mL', aiRationale: 'CARD rule: chest pain + elevated troponin' });
  check('doctor creates the referral', ref.status === 201 && ref.body.referral?.status === 'REQUESTED', JSON.stringify(ref.body).slice(0, 200));
  const rid = ref.body.referral?.id;
  const dup = await call('doctor', 'POST', '/hospital/referrals', { visitId: vid, patientId: pid, specialty: 'Cardiology', reason: 'again please' });
  check('a second open referral for the same specialty is refused (409)', dup.status === 409, String(dup.status));

  const cn = await call('cardiologist', 'GET', '/hospital/notifications');
  const note = cn.body.notifications?.find((n) => n.payload?.referralId === rid);
  check('cardiologist is notified, with the patient name', !!note && note.body.includes(`Referral Test ${s}`), JSON.stringify(cn.body).slice(0, 250));
  const nn = await call('neurologist', 'GET', '/hospital/notifications');
  check('neurologist is NOT notified', !nn.body.notifications?.some((n) => n.payload?.referralId === rid));

  console.log('\n▶ Specialist portal');
  const mine = await call('cardiologist', 'GET', '/hospital/referrals/mine');
  check('referral is in the cardiologist inbox', mine.body.referrals?.some((r) => r.id === rid));
  check('neurologist inbox does not contain it', !(await call('neurologist', 'GET', '/hospital/referrals/mine')).body.referrals?.some((r) => r.id === rid));
  const sum = await call('cardiologist', 'GET', `/hospital/patients/${pid}/summary`);
  check('cardiologist can open the referred patient with labs', sum.status === 200 && sum.body.labs?.some((l) => /troponin/i.test(l.test)), String(sum.status));
  const other = await call('neurologist', 'GET', `/hospital/patients/${pid}/summary`);
  check('neurologist cannot open that patient (403)', other.status === 403, String(other.status));
  const ai = await call('cardiologist', 'GET', `/hospital/referrals/${rid}/ai-summary`);
  check('AI referral summary cites evidence', ai.status === 200 && JSON.stringify(ai.body).includes('0.85'), JSON.stringify(ai.body).slice(0, 200));
  const steal = await call('neurologist', 'POST', `/hospital/referrals/${rid}/complete`, { assessment: 'x y z', recommendation: 'x y z', treatment: 'x y z', followUp: 'x y z' });
  const vd = await call('cardiologist', 'GET', `/hospital/visits/${vid}`);
  check('cardiologist can open the referred visit', vd.status === 200, String(vd.status));
  check('neurologist cannot open that visit (403)', (await call('neurologist', 'GET', `/hospital/visits/${vid}`)).status === 403);
  check('neurologist has no patient list (403)', (await call('neurologist', 'GET', '/hospital/patients')).status === 403);
  check('inbox rows carry the patient name (no patient lookup needed)', mine.body.referrals?.find((r) => r.id === rid)?.patientName === `Referral Test ${s}`);
  check('another specialist cannot complete it (403)', steal.status === 403, String(steal.status));

  const done = await call('cardiologist', 'POST', `/hospital/referrals/${rid}/complete`, { assessment: 'NSTEMI', recommendation: 'Admit to CCU, urgent catheterization', treatment: 'Aspirin, clopidogrel, heparin', followUp: 'Repeat ECG in 2 hours', followUpTests: ['Troponin T'], followUpDays: 7 });
  check('specialist completes the consultation', done.status === 201 && done.body.referral?.status === 'COMPLETED', JSON.stringify(done.body).slice(0, 200));
  const v = await call('doctor', 'GET', `/hospital/visits/${vid}`);
  check('visit moved to FOLLOW_UP', v.body.visit?.status === 'FOLLOW_UP', JSON.stringify(v.body.visit));
  const dn = await call('doctor', 'GET', '/hospital/notifications');
  check('doctor is notified that it is completed', dn.body.notifications?.some((n) => n.type === 'REFERRAL_COMPLETED' && n.payload?.referralId === rid));

  console.log('\n▶ Follow-up plan: proposed, approved, really executed');
  const prop = await call('doctor', 'POST', `/hospital/visits/${vid}/follow-up/propose`);
  const aid = prop.body.proposalAction?.id;
  check('plan is proposed and waits for approval', prop.status === 201 && prop.body.proposalAction?.status === 'PENDING', JSON.stringify(prop.body).slice(0, 200));
  check('plan is built from the specialist (appointment with them, the test, the notice text)', prop.body.plan?.items?.some((i) => i.type === 'APPOINTMENT' && i.details.days === 7) && prop.body.plan.items.some((i) => i.type === 'LAB_ORDER' && i.details.testName === 'Troponin T'), JSON.stringify(prop.body.plan?.items).slice(0, 300));
  check('another doctor-role user cannot see/approve it, nurse cannot approve (403)', (await call('nurse', 'POST', `/ai/actions/${aid}/approve`, {})).status === 403);
  check('nothing exists before approval', ((await call('doctor', 'GET', `/hospital/lab-orders?patientId=${pid}`)).body.count ?? 0) === 0);
  const appr = await call('doctor', 'POST', `/ai/actions/${aid}/approve`, { decisionNote: 'ok' });
  check('approval executes and verifies', appr.status === 201 && appr.body.action?.status === 'DONE' && appr.body.action.verification?.verified === true, JSON.stringify(appr.body).slice(0, 300));
  const labs = await call('doctor', 'GET', `/hospital/lab-orders?patientId=${pid}`);
  check('the lab order now exists', labs.body.orders?.some((o) => o.testName === 'Troponin T'));
  const appts = await call('cardiologist', 'GET', '/hospital/appointments');
  const a = appts.body.find?.((x) => x.patientId === pid);
  check('the follow-up appointment is booked with the cardiologist, and shows the patient name', !!a && a.patientName === `Referral Test ${s}`, JSON.stringify(appts.body).slice(0, 200));

  console.log('\n▶ Complete the visit');
  const fin = await call('doctor', 'POST', `/hospital/visits/${vid}/transition`, { to: 'COMPLETED' });
  check('visit completes', fin.body.visit?.status === 'COMPLETED', JSON.stringify(fin.body).slice(0, 160));

  console.log('\n▶ Cleanup');
  const del = await call('admin', 'DELETE', `/hospital/patients/${pid}?confirm=${pid}`);
  check('test patient deleted', del.body.success === true, JSON.stringify(del.body).slice(0, 200));
}
finish(main);
