/**
 * Real questions through POST /ai/chat against the RUNNING API, for every answer that is produced WITHOUT the language
 * model (exact, instant). Each answer is compared with the numbers/names the REST API reports for the same data, so a
 * wrong route ("how many specialists" => patient overview) fails here. Run: `npm run test:workflow`.
 */
import { call, check, finish, login } from './client.mjs';

async function ask(as, message) {
  const t0 = Date.now();
  const r = await call(as, 'POST', '/ai/chat', { message });
  return { text: r.body.response ?? JSON.stringify(r.body), ms: Date.now() - t0, tools: (r.body.toolCalls ?? []).map((c) => c.name), mode: r.body.mode };
}

async function main() {
  await login('doctor', 'receptionist', 'nurse');
  const ov = (await call('doctor', 'GET', '/hospital/overview')).body;
  const specs = (await call('doctor', 'GET', '/hospital/specialists')).body;
  const patients = (await call('doctor', 'GET', '/hospital/patients?limit=200')).body;
  // a real-looking name (letters only, last word 6+ letters) so a typo can be made from it
  const sample = patients.items.find((p) => /^[A-Za-z]+ [A-Za-z]{6,}$/.test(p.name)) ?? patients.items[0];
  const FAST = 8000; // a direct answer must not wait for the model

  console.log('\n▶ Counts: each question gets its own number');
  let r = await ask('doctor', 'how many patients are there');
  check('patients', new RegExp(`Total patients: ${ov.totalPatients}\\b`).test(r.text) && !/Pending staff tasks/.test(r.text) && r.ms < FAST, r.text);
  r = await ask('doctor', 'how many appointments are scheduled');
  check('appointments', new RegExp(`Scheduled appointments: ${ov.scheduledAppointments}\\b`).test(r.text) && !/Total patients/.test(r.text), r.text);
  r = await ask('doctor', 'how many tasks are pending');
  check('tasks', new RegExp(`Pending staff tasks: ${ov.pendingStaffTasks}\\b`).test(r.text) && !/Total patients/.test(r.text), r.text);
  r = await ask('doctor', 'how many patients are waiting');
  check('waiting', new RegExp(`Waiting for triage: ${ov.waitingForTriage}\\b`).test(r.text) && new RegExp(`Waiting for a doctor: ${ov.waitingForDoctor}\\b`).test(r.text), r.text);
  r = await ask('doctor', 'give me the hospital overview');
  check('overview shows every figure', /Total patients/.test(r.text) && /Scheduled appointments/.test(r.text) && /Pending staff tasks/.test(r.text), r.text);

  console.log('\n▶ Staff');
  r = await ask('doctor', 'how many specialists are there');
  check('specialists (count and names from the accounts)', new RegExp(`There (is|are) ${specs.length} specialists?`).test(r.text) && specs.every((s) => r.text.includes(s.name)) && !/Hospital overview/.test(r.text), r.text);
  r = await ask('doctor', 'who are the cardiologists');
  check('named specialty', specs.filter((s) => s.specialty === 'Cardiology').every((s) => r.text.includes(s.name)) && !specs.filter((s) => s.specialty !== 'Cardiology').some((s) => r.text.includes(s.name)), r.text);
  r = await ask('doctor', 'how many doctors are there');
  check('doctors (staff accounts, not patients)', /\b(doctor|There (is|are) \d+ doctor)/i.test(r.text) && !/Total patients/.test(r.text), r.text);

  console.log('\n▶ Things the system does not track');
  r = await ask('doctor', 'how many beds are available');
  check('beds: says it does not keep that count', /do not keep a count of "beds"/.test(r.text) && r.ms < FAST, r.text);

  console.log('\n▶ Patient lookups (exact, from the chart)');
  r = await ask('doctor', `give details about ${sample.name}`);
  check(`"give details about ${sample.name}" is a lookup`, r.text.includes(sample.id) && r.mode !== 'agent' && r.ms < FAST, r.text);
  // a typo in EVERY word of the name (a correct first name would simply match exactly)
  const misspelt = sample.name.split(' ').map((w) => w.replace(/(.)(.)(.)$/, '$3$1$2')).join(' ');
  r = await ask('doctor', `show details for ${misspelt}`);
  check('a typo in the name is corrected and disclosed', r.text.includes(sample.id) && /you typed/.test(r.text), r.text);
  r = await ask('doctor', 'give details about Zzyzx Qwerty');
  check('an unknown name is reported, not invented', /could not find a patient named/.test(r.text) && r.ms < FAST, r.text);
  r = await ask('doctor', 'show details of patient PZZZZZZ');
  check('an unknown id is reported', /No patient with id PZZZZZZ/.test(r.text), r.text);
  r = await ask('doctor', 'list all patients');
  check('the list holds every patient', patients.items.every((p) => r.text.includes(p.id)), `${r.text.slice(0, 120)}…`);

  console.log('\n▶ Minimum necessary through the chat');
  r = await ask('receptionist', `show the labs and allergies of ${sample.id}`);
  check('a receptionist is not given clinical sections', !/HbA1c|Penicillin|Creatinine|Troponin/i.test(r.text) && /not available for your role|demographic/i.test(r.text), r.text);
}
finish(main);
