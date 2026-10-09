/**
 * END-TO-END ANSWER QUALITY for hospital-policy questions, with the REAL configured model (slow).
 * Each answer must contain the fact that is written in the knowledge documents AND must come from the right document;
 * the last question has no answer in the documents and must NOT be invented.
 *   node --env-file=.env tests/workflow/rag-answers-live.mjs
 */
import { call, login } from './client.mjs';

const CASES = [
  ['How long must a patient\'s vitals stay stable before they can go home?', /12/, 'discharge-policy'],
  ['What does the attending physician have to sign before a patient is discharged?', /discharge summary/i, 'discharge-policy'],
  ['Which kind of antibiotic should be avoided for someone with a penicillin allergy?', /beta-lactam|alternative/i, 'discharge'],
  ['At what blood glucose level is a red alert raised?', /250/, 'emergency'],
  ['How far ahead must a routine follow-up be booked?', /48/, 'appointment-policy'],
  ['Who must an urgent consultation request be routed to?', /triage nurse/i, 'appointment-policy'],
  ['How many nurses must check insulin before it is given?', /two|2/i, 'medication-administration'],
  ['Within how many hours must an adverse drug reaction be logged?', /4 hours|four hours|\b4\b/i, 'medication-administration'],
  ['What two identifiers are needed before giving any medication?', /(name)[\s\S]*(patient id|record|id number)|(patient id|record|id number)[\s\S]*(name)/i, 'medication-administration'],
  ['What should I do first if a patient gets a rash after a drug?', /suspen|stop/i, 'medication-administration'],
  ['Does cancelling an appointment with 12 hours notice need anyone\'s approval?', /supervis/i, 'appointment-policy'],
  ['What is the hospital policy on staff parking fees?', /not (in|found)|no (information|record)|don'?t (have|know)|cannot find|not available|isn't/i, null],
];

await login('doctor');
let pass = 0;
for (const [q, fact, doc] of CASES) {
  const t0 = Date.now();
  const r = await call('doctor', 'POST', '/ai/chat', { message: q });
  const text = r.body.response ?? JSON.stringify(r.body);
  const cites = (r.body.citations ?? []).map((c) => c.file).join(',');
  const factOk = fact.test(text);
  const docOk = doc ? cites.includes(doc) : true;
  const ok = factOk && docOk;
  if (ok) pass++;
  console.log(`${ok ? '✅' : '❌'} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${r.body.mode}) ${q}\n    fact:${factOk} source:${docOk} [${cites}]\n    → ${text.replace(/\s+/g, ' ').slice(0, 230)}`);
}
console.log(`\nRAG ANSWER QUALITY: ${pass}/${CASES.length}`);
process.exit(0);
