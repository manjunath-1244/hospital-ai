/**
 * Who may call what: every role against every endpoint, written BEFORE looking at the code (the specification).
 * Allowed  => the request must get past authorization (any status except 401/403: 400/404 for the dummy input is fine).
 * Forbidden => must be exactly 403.
 * Bodies are empty or ids are dummies, so nothing is created. Run: `npm run test:workflow`.
 */
import { call, check, finish, login } from './client.mjs';

const ROLES = {
  RECEPTIONIST: 'receptionist',
  NURSE: 'nurse',
  DOCTOR: 'doctor',
  RADIOLOGIST: 'radiologist',
  PHARMACIST: 'pharmacist',
  CARE_COORDINATOR: 'coordinator',
  ADMIN: 'admin',
  SPECIALIST: 'cardiologist',
};
const ALL = Object.keys(ROLES);
const STAFF = ALL.filter((r) => r !== 'SPECIALIST');
const without = (list, ...r) => list.filter((x) => !r.includes(x));

const P = 'P1001';
const V = 'V0000000';
// [method, path, body, allowed roles, note]
const MATRIX = [
  // --- patients and chart sections (minimum necessary) ---
  [
    'GET',
    '/hospital/patients',
    null,
    STAFF,
    'a specialist has no patient list; they work from their referral inbox',
  ],
  ['GET', `/hospital/patients/${P}`, null, STAFF],
  ['GET', `/hospital/patients/${P}/summary`, null, STAFF],
  ['GET', `/hospital/patients/${P}/visits`, null, STAFF],
  [
    'GET',
    `/hospital/patients/${P}/labs`,
    null,
    ['DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'RADIOLOGIST'],
  ],
  [
    'GET',
    `/hospital/patients/${P}/medications`,
    null,
    ['DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST'],
  ],
  ['GET', `/hospital/patients/${P}/vitals`, null, ['DOCTOR', 'NURSE', 'ADMIN']],
  [
    'GET',
    `/hospital/patients/${P}/imaging`,
    null,
    ['DOCTOR', 'NURSE', 'ADMIN', 'RADIOLOGIST'],
  ],
  [
    'GET',
    `/hospital/patients/${P}/referral-recommendation`,
    null,
    ['DOCTOR', 'NURSE', 'ADMIN'],
  ],
  [
    'DELETE',
    `/hospital/patients/${P}`,
    null,
    ['ADMIN'],
    'no ?confirm => 400 for admin, nothing deleted',
  ],
  // --- front desk, triage, consultation, labs, imaging ---
  ['POST', '/hospital/lifecycle/register-op', {}, ['RECEPTIONIST', 'ADMIN']],
  [
    'POST',
    `/hospital/patients/${P}/visits`,
    {},
    ['RECEPTIONIST', 'NURSE', 'ADMIN'],
    'open visit => 409 for allowed roles',
  ],
  ['POST', '/hospital/lifecycle/triage', {}, ['NURSE', 'DOCTOR', 'ADMIN']],
  ['POST', '/hospital/lifecycle/record-consultation', {}, ['DOCTOR', 'ADMIN']],
  [
    'POST',
    '/hospital/lifecycle/lab-result',
    {},
    ['RADIOLOGIST', 'DOCTOR', 'NURSE', 'ADMIN'],
  ],
  ['POST', '/hospital/lifecycle/imaging-study', {}, ['RADIOLOGIST', 'ADMIN']],
  [
    'GET',
    '/hospital/lifecycle/queue',
    null,
    ['RECEPTIONIST', 'DOCTOR', 'NURSE', 'ADMIN'],
  ],
  ['GET', '/hospital/lifecycle/ward', null, ['DOCTOR', 'NURSE', 'ADMIN']],
  [
    'GET',
    '/hospital/lifecycle/unconsulted-alerts',
    null,
    ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'],
  ],
  [
    'GET',
    '/hospital/overview',
    null,
    ['DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR'],
  ],
  ['GET', '/hospital/visits', null, STAFF],
  // --- pharmacy ---
  [
    'GET',
    '/hospital/pharmacy/queue',
    null,
    ['PHARMACIST', 'ADMIN'],
    "the dispensing queue is the pharmacist's screen",
  ],
  [
    'POST',
    '/hospital/pharmacy/audit',
    {},
    ['PHARMACIST', 'DOCTOR', 'ADMIN'],
    'doctors may screen a drug list; nurses use the agent/summary alerts',
  ],
  // --- appointments and tasks ---
  [
    'GET',
    '/hospital/appointments',
    null,
    ['DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'SPECIALIST'],
    'specialist sees only their own',
  ],
  [
    'POST',
    '/hospital/appointments',
    {},
    ['DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST'],
  ],
  [
    'GET',
    '/hospital/tasks',
    null,
    ['DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR'],
  ],
  [
    'POST',
    '/hospital/tasks',
    {},
    ['DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR'],
  ],
  // --- specialists, referrals, follow-up, lab orders ---
  ['GET', '/hospital/specialists', null, ALL],
  ['GET', '/hospital/specialties', null, ALL],
  [
    'PUT',
    '/hospital/specialists/USR-NOSUCH/hours',
    { windows: [] },
    ['ADMIN'],
    'unknown doctor => 404, nothing is changed',
  ],
  ['POST', '/hospital/referrals', {}, ['DOCTOR', 'NURSE', 'ADMIN']],
  ['GET', '/hospital/referrals', null, ['DOCTOR', 'NURSE', 'ADMIN']],
  ['GET', '/hospital/referrals/mine', null, ['SPECIALIST']],
  [
    'GET',
    '/hospital/referrals/CR000000',
    null,
    ['DOCTOR', 'NURSE', 'ADMIN'],
    'a specialist gets 403 for any referral that is not theirs (a made-up id is not)',
  ],
  [
    'POST',
    '/hospital/referrals/CR000000/complete',
    {},
    ['SPECIALIST', 'ADMIN'],
  ],
  [
    'POST',
    `/hospital/visits/${V}/follow-up/propose`,
    {},
    ['DOCTOR', 'NURSE', 'ADMIN', 'CARE_COORDINATOR'],
  ],
  [
    'GET',
    `/hospital/visits/${V}/follow-up`,
    null,
    ['DOCTOR', 'NURSE', 'ADMIN', 'CARE_COORDINATOR'],
  ],
  ['POST', '/hospital/lab-orders', {}, ['DOCTOR', 'NURSE', 'ADMIN']],
  [
    'GET',
    '/hospital/lab-orders',
    null,
    ['DOCTOR', 'NURSE', 'ADMIN', 'RADIOLOGIST'],
  ],
  // --- everyone has their own inbox, chat and proposals ---
  ['GET', '/hospital/notifications', null, ALL],
  ['GET', '/hospital/notifications/unread-count', null, ALL],
  ['GET', '/ai/actions', null, ALL, 'own proposals only'],
  ['GET', '/ai/threads', null, ALL],
  ['GET', '/auth/me', null, ALL],
  // --- administration ---
  ['GET', '/admin/health', null, ['ADMIN']],
  ['GET', '/admin/audit-logs', null, ['ADMIN']],
  ['GET', '/admin/agent/metrics', null, ['ADMIN']],
  ['GET', '/admin/agent/runs', null, ['ADMIN']],
  ['GET', '/admin/knowledge', null, ['ADMIN']],
  ['POST', '/admin/knowledge', {}, ['ADMIN'], 'empty body => 400'],
  ['DELETE', '/admin/knowledge/NOSUCHDOC', null, ['ADMIN']],
];
// Heavy or irreversible when allowed: only the FORBIDDEN side is exercised.
const FORBIDDEN_ONLY = new Set(['POST /admin/knowledge/reindex']);
MATRIX.push(['POST', '/admin/knowledge/reindex', null, ['ADMIN']]);

async function main() {
  await login(...Object.values(ROLES));
  let cells = 0;
  for (const [method, path, body, allowed, note] of MATRIX) {
    const bad = [];
    for (const role of ALL) {
      const mayCall = allowed.includes(role);
      if (mayCall && FORBIDDEN_ONLY.has(`${method} ${path}`)) continue;
      const res = await call(ROLES[role], method, path, body ?? undefined);
      cells++;
      const ok = mayCall
        ? res.status !== 403 && res.status !== 401
        : res.status === 403;
      if (!ok)
        bad.push(
          `${role} ${mayCall ? 'should be allowed' : 'should be refused'} (got ${res.status})`,
        );
    }
    check(
      `${method.padEnd(6)} ${path}${note ? `   [${note}]` : ''}`,
      bad.length === 0,
      bad.join('; '),
    );
  }
  console.log(`\n${cells} role/endpoint combinations checked`);

  console.log(
    '\n▶ Each role sees only the chart sections it needs (minimum necessary)',
  );
  const SECTIONS = [
    'conditions',
    'allergies',
    'currentMedications',
    'labs',
    'recentVitals',
    'recentConsultations',
    'imaging',
    'appointments',
    'medicationSafetyAlerts',
  ];
  const CLINICAL = [
    'conditions',
    'allergies',
    'currentMedications',
    'labs',
    'recentVitals',
    'recentConsultations',
    'imaging',
    'appointments',
    'medicationSafetyAlerts',
  ];
  const SEES = {
    RECEPTIONIST: ['appointments'],
    NURSE: CLINICAL,
    DOCTOR: CLINICAL,
    ADMIN: CLINICAL,
    RADIOLOGIST: ['conditions', 'allergies', 'labs', 'imaging'],
    PHARMACIST: [
      'conditions',
      'allergies',
      'currentMedications',
      'labs',
      'recentConsultations',
      'medicationSafetyAlerts',
    ],
    CARE_COORDINATOR: [
      'conditions',
      'currentMedications',
      'recentConsultations',
      'appointments',
    ],
  };
  for (const [role, sees] of Object.entries(SEES)) {
    const r = await call(ROLES[role], 'GET', `/hospital/patients/${P}/summary`);
    const present = SECTIONS.filter((k) => k in r.body);
    const extra = present.filter((k) => !sees.includes(k));
    const missing = sees.filter(
      (k) => !present.includes(k) && k !== 'medicationSafetyAlerts',
    );
    check(
      `${role}: sees ${sees.length ? sees.join(', ') : 'demographics only'}`,
      r.status === 200 &&
        !extra.length &&
        !missing.length &&
        r.body.patient?.id === P,
      `status ${r.status}; too much: [${extra}]; missing: [${missing}]`,
    );
  }
  const rec = await call(ROLES.RECEPTIONIST, 'GET', `/hospital/patients/${P}`);
  check(
    'RECEPTIONIST: patient record has no allergies, medications or conditions',
    rec.status === 200 &&
      !rec.body.allergies?.length &&
      !rec.body.currentMedications?.length &&
      !rec.body.conditions?.length,
  );

  // the plain patient record must agree with the chart summary (same minimum-necessary rules)
  for (const [role, sees] of Object.entries(SEES)) {
    const r = await call(ROLES[role], 'GET', `/hospital/patients/${P}`);
    const has = (k) => Array.isArray(r.body[k]) && r.body[k].length > 0;
    const wrong = [];
    if (has('conditions') !== sees.includes('conditions')) wrong.push('conditions');
    if (has('allergies') !== sees.includes('allergies')) wrong.push('allergies');
    if (has('currentMedications') !== sees.includes('currentMedications')) wrong.push('currentMedications');
    check(
      `${role}: GET /hospital/patients/:id shows the same clinical parts as the summary`,
      r.status === 200 && !wrong.length,
      `status ${r.status}; differs: [${wrong}]`,
    );
  }

  console.log('\n▶ Unauthenticated requests are refused');
  for (const p of [
    '/hospital/patients',
    '/ai/threads',
    '/admin/health',
    '/hospital/notifications',
  ])
    check(
      `GET ${p} without a token`,
      (await call(null, 'GET', p)).status === 401,
    );
}
finish(main);
