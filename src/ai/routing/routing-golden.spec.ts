import { classifyIntent } from './intent';

/**
 * Golden questions: what a staff member would really type, and how the system must route it.
 * Written as the specification BEFORE changing the routing; a failure here means the agent would answer from the wrong
 * data (the "how many specialists" => patient overview bug was one of these).
 */
type Expect = {
  write?: boolean;
  overview?: boolean;
  waiting?: boolean;
  list?: boolean;
  policy?: boolean;
  medication?: boolean;
  specialists?: boolean;
  staff?: boolean;
  review?: boolean;
  crossSearch?: boolean;
  metrics?: string[];
  unsupported?: boolean;
};
const CASES: Array<[string, Expect]> = [
  // ---- counts: each noun must reach its own data, never "everything"
  ['how many patients are there', { overview: true, metrics: ['patients'] }],
  ['total number of patients', { overview: true, metrics: ['patients'] }],
  [
    'how many patients are waiting',
    { overview: true, waiting: true, metrics: ['waiting'] },
  ],
  [
    'how many patients are waiting for a doctor',
    { overview: true, metrics: ['waiting'] },
  ],
  [
    'how many appointments are scheduled',
    { overview: true, metrics: ['appointments'], write: false },
  ],
  [
    'number of appointments today',
    { overview: true, metrics: ['appointments'] },
  ],
  ['how many tasks are pending', { overview: true, metrics: ['tasks'] }],
  [
    'how many critical labs in the last day',
    { overview: true, metrics: ['criticalLabs'] },
  ],
  [
    'how many patients were completed today',
    { overview: true, metrics: ['completedToday'] },
  ],
  [
    'how many patients are with a doctor right now',
    { overview: true, metrics: ['withDoctor'] },
  ],
  ['give me the hospital overview', { overview: true, metrics: [] }],
  ['hospital statistics', { overview: true, metrics: [] }],
  ['how many specialists are there', { specialists: true, overview: false }],
  ['how many cardiologists do we have', { specialists: true, overview: false }],
  ['who are the neurologists', { specialists: true, overview: false }],
  ['how many doctors are there', { staff: true, overview: false }],
  ['how many nurses do we have', { staff: true, overview: false }],
  ['how many beds are available', { unsupported: true, overview: false }],
  ['how many ambulances do we have', { unsupported: true, overview: false }],
  // ---- "how many" about a patient or a policy value is not a hospital count
  [
    'how many hours must vitals be stable before a patient can be discharged',
    { unsupported: false, overview: false },
  ],
  [
    'how many days before a routine follow-up must be booked',
    { unsupported: false, overview: false },
  ],
  [
    'how many mg of paracetamol can P1001 take',
    { unsupported: false, overview: false },
  ],
  ['how many labs does P1001 have', { unsupported: false, overview: false }],
  [
    'how many times has P1002 been seen',
    { unsupported: false, overview: false },
  ],
  // ---- reads that contain "action" words must NOT be treated as actions
  ['any update on James Miller', { write: false }],
  ['show me the medical record of P1001', { write: false }],
  ['what is the record for Eleanor Vance', { write: false }],
  ['what is the discharge policy', { write: false, policy: true }],
  ['when is the patient going to be discharged', { write: false }],
  ['what orders are there for P1002', { write: false }],
  ['show the transfer policy', { write: false, policy: true }],
  ['is there a referral for P1002', { write: false }],
  [
    'what is the cancellation policy for appointments',
    { write: false, policy: true },
  ],
  ['how do I register a new patient', { write: false }],
  ["when is Eleanor Vance's next appointment", { write: false }],
  ['what allergies does P1001 have', { write: false, medication: false }],
  ['what medications is Marcus Brody on', { write: false, medication: false }],
  ['give details about James Miller', { write: false, medication: false }],
  // ---- real action requests
  ['refer P1002 to cardiology', { write: true, review: false }],
  ['please refer him to a cardiologist', { write: true }],
  ['can you book an appointment for P1001 tomorrow at 10', { write: true }],
  ['book an appointment with Dr. Sarah Wilson', { write: true }],
  ['register a new patient John Doe 40 male', { write: true }],
  ['I want to register a patient', { write: true }],
  ['cancel the appointment for P1001', { write: true }],
  ['close the visit for P1001', { write: true }],
  ['order a troponin for P1002', { write: true }],
  ['add a task for the nurse to check vitals', { write: true }],
  ['generate a follow-up plan for P1004', { write: true }],
  ['notify the cardiologist about P1002', { write: true }],
  ['record a consultation for P1001: diagnosis flu', { write: true }],
  ['yes, go ahead', { write: true }],
  ['confirm', { write: true }],
  // ---- medication questions
  ['is it safe to give aspirin to P1002', { medication: true }],
  ['can I prescribe amoxicillin for P1001', { medication: true }],
  ['any interaction between warfarin and ibuprofen', { medication: true }],
  // past tense "give" asks what is in the chart; only safety/dosing wording is a medication QUESTION
  ['what did the doctor give him', { medication: false, write: false }],
  ['is it safe to give her aspirin', { medication: true }],
  // ---- lists, queue, policy, search, review
  ['list all patients', { list: true }],
  ['show every patient', { list: true }],
  ['who is waiting', { waiting: true }],
  ['who is in the queue', { waiting: true }],
  ['what is the emergency escalation protocol', { policy: true }],
  ['which patients have chest pain', { crossSearch: true }],
  ['is a specialist required for P1002', { review: true, write: false }],
  ['review P1002 and tell me if a specialist is needed', { review: true }],
  ['should I refer P1002', { review: true }],
  // ---- chit-chat must not trigger data routes
  [
    'hello',
    {
      write: false,
      overview: false,
      list: false,
      policy: false,
      specialists: false,
    },
  ],
  ['thanks', { write: false, overview: false, list: false }],
  [
    'what can you do',
    { write: false, overview: false, list: false, specialists: false },
  ],
];

describe('routing golden questions', () => {
  it.each(CASES)('%s', (question, expected) => {
    const got: any = classifyIntent(question);
    const mismatches = Object.entries(expected).filter(([k, v]) =>
      k === 'metrics'
        ? JSON.stringify(got.metrics) !== JSON.stringify(v)
        : got[k] !== v && !(v === false && got[k] === undefined),
    );
    expect(
      mismatches.map(
        ([k, v]) =>
          `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`,
      ),
    ).toEqual([]);
  });
});
