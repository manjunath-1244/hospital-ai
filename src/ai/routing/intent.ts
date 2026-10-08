export interface Intent {
  /** The user wants something changed (book, register, prescribe...). Needs the tool agent, never grounded-only mode. */
  write: boolean;
  list: boolean;
  waiting: boolean;
  overview: boolean;
  policy: boolean;
  /** Contains patient vital-sign numbers to be scored (NEWS2/ESI): needs the calculator tool, not policy text. */
  triage: boolean;
  /** Asks whether a (proposed) drug is safe/appropriate: needs the safety-check tool, not just the chart. */
  medication: boolean;
  /** "which patients ..." style question across the whole hospital. */
  crossSearch: boolean;
  /** Asks for patient referral review or specialist recommendation. */
  review: boolean;
  /** Asks about the specialists themselves (how many, who, which specialty): answered from the staff data. */
  specialists: boolean;
  /** Asks about staff by role (doctors, nurses, pharmacists...). */
  staff: boolean;
  /** Which hospital numbers a count question asks for (empty = the whole overview). */
  metrics: OverviewMetric[];
  /** A count question about something the system does not track (beds, ambulances...). */
  unsupported: boolean;
  /** The thing being counted, as typed (for the "I do not track X" answer). */
  countedNoun: string | null;
}

export type OverviewMetric =
  | 'patients'
  | 'waiting'
  | 'withDoctor'
  | 'completedToday'
  | 'criticalLabs'
  | 'tasks'
  | 'appointments';

const rx = (s: RegExp) => (t: string) => s.test(t);

// ---- action requests -------------------------------------------------------------------------------------------------
// A request to CHANGE something starts with a verb ("book...", "please refer him...", "can you cancel..."), in any
// clause. The same words inside a question ("any update on X", "the medical record of X", "the discharge policy") are
// reads and must not send the question to the slow tool agent.
const ACTION_VERBS =
  'book|schedule|reschedule|register|admit|prescribe|record|create|add|assign|cancel|close|reopen|delete|remove|' +
  'update|order|discharge|refer|notify|propose|arrange|escalate|transfer|send|enter|log|complete|set up';
const POLITE_PREFIX =
  /^(?:(?:hi|hello|hey|ok|okay|so|and|then|now|also)[,!. ]+)*(?:(?:please|kindly)[, ]+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s*(?:'d|\s+would)?\s*(?:like|want|need)\s+(?:you\s+)?to\s+|i\s+need\s+you\s+to\s+|let'?s\s+|go\s+ahead\s+and\s+)?/i;
// "update on", "record of/for", "order status" are nouns here, not commands
const ACTION_START = new RegExp(
  `^(?:${ACTION_VERBS})\\b(?!\\s+(?:on|of|for|about|status|history|policy)\\b)`,
  'i',
);
const FOLLOW_UP_PLAN =
  /^generate\b[^.?!]*\b(follow[- ]?up|referral|order|task|plan)\b/i;
const CONFIRMATION =
  /^(?:yes|yeah|yep|yup|sure|confirm(?:ed)?|approve(?:d)?|go ahead|proceed|do it|please do|that'?s right|correct|ok(?:ay)?)\b(?!\s*,?\s*thank)/i;

export function isActionRequest(message: string): boolean {
  const text = message.trim();
  if (CONFIRMATION.test(text)) return true;
  return text
    .split(/(?:[.;!?]|,|\band\b|\bthen\b)\s*/i)
    .map((seg) => seg.trim().replace(POLITE_PREFIX, ''))
    .some((seg) => ACTION_START.test(seg) || FOLLOW_UP_PLAN.test(seg));
}
const WRITE = isActionRequest;
const LIST = rx(
  /\b(all|every|each)\b[^.?!]*\bpatients?\b|\blist\b[^.?!]*\bpatients?\b|\bpatients?\b[^.?!]*\b(list|registered|in the (hospital|system|database))\b|\bpatient details\b/i,
);
const WAITING = rx(
  /\bwaiting\b|\bqueue\b|\bunconsulted\b|\bnot (yet )?(been )?seen\b/i,
);
const OVERVIEW_WORDS = rx(/\b(overview|statistics|stats|dashboard)\b/i);
const COUNT = rx(
  /\b(how many|number of|count of|total (?:number|count)(?: of)?|count)\b/i,
);
// What a count question may be about -> the hospital number that answers it. Specific nouns beat the generic "patients".
const METRIC_NOUNS: Array<[OverviewMetric, RegExp]> = [
  ['appointments', /\b(appointments?|bookings?)\b/i],
  ['tasks', /\b(tasks?|to-?dos?)\b/i],
  [
    'criticalLabs',
    /\bcritical\b[^.?!]*\b(labs?|results?|values?)\b|\b(labs?|results?)\b[^.?!]*\bcritical\b/i,
  ],
  [
    'completedToday',
    /\b(completed|discharged|finished|done)\b[^.?!]*\b(today|so far)\b|\btoday\b[^.?!]*\b(completed|discharged|finished)\b/i,
  ],
  ['withDoctor', /\b(with (?:a|the) doctor|in consultation|being seen)\b/i],
  ['waiting', /\b(waiting|queue|unconsulted)\b/i],
];
// "how many hours / mg / times ...": a value to look up in a policy or a chart, never a hospital head-count
const QUANTITY_NOUNS =
  /\b(?:how many|number of)\s+(?:more\s+|extra\s+)?(?:hours?|minutes?|mins?|days?|weeks?|months?|years?|mg|mcg|ml|doses?|times|tablets?|pills?|units?|steps?|levels?|points?|signatures?|approvals?|attempts?|readings?|labs?|results?|medications?|drugs?|allergies|conditions|visits?\s+(?:has|have|did|does))\b/i;
const GENERIC_PATIENTS = /\b(patients?|people|visits?|admissions?)\b/i;
const STAFF_WORDS = rx(
  /\b(doctors?|physicians?|nurses?|pharmacists?|radiologists?|receptionists?|coordinators?|staff|employees)\b/i,
);
const POLICY = rx(
  /\b(policy|policies|protocol|protocols|procedure|procedures|sop|sops|guideline|guidelines|standard operating|criteria|escalation|code word|visiting|handbook|document|documents)\b/i,
);
const VITAL_WORDS = [
  /\b(hr|heart rate|pulse)\b/i,
  /\b(bp|blood pressure|systolic)\b/i,
  /\b(spo2|sats?|saturation|oxygen)\b/i,
  /\b(temp|temperature)\b/i,
  /\b(rr|resp(iratory)? rate|breathing)\b/i,
];
const TRIAGE = (t: string) =>
  (/\b(news2|triage|vitals?)\b/i.test(t) && /\d/.test(t)) ||
  (VITAL_WORDS.filter((r) => r.test(t)).length >= 3 && /\d/.test(t));
const MEDICATION = rx(
  /\b(prescrib\w*|safe|safely|interaction|interactions|contraindicat\w*|dosage|dose|administer|start(ing)? (on|him|her|them))\b|\b(give|giving|gave)\s+(him|her|them|the patient|it|this|that)\b/i,
);
const CROSS = rx(
  /\b(which|who)\b[^.?!]*\b(patients?|has|have|had|are|is|on|taking|allergic|diagnosed|suffering|complain)/i,
);
const REVIEW = rx(
  /\b(review|recommend\w*|should (i|we) refer|(is|are) (a )?specialists? (required|needed|necessary)|needs? (a )?specialist|requires? (a )?specialist|specialist (required|needed|necessary))\b/i,
);

const SPECIALISTS = rx(
  /\b(specialists?|cardiologists?|neurologists?|consultants?)\b/i,
);

/** Cheap, deterministic, explainable routing of a message to the data it needs. */
export function classifyIntent(message: string): Intent {
  const list = LIST(message);
  const waiting = WAITING(message);
  const review = REVIEW(message);
  const action = WRITE(message);
  const counting = COUNT(message);
  // Staff questions ("how many specialists", "who are the nurses") are about people on the payroll, not patients.
  const specialists =
    SPECIALISTS(message) &&
    !review &&
    !action &&
    !/\bpatients?\b/i.test(message);
  const staff =
    !specialists &&
    !action &&
    !review &&
    STAFF_WORDS(message) &&
    !/\bpatients?\b/i.test(message) &&
    (counting || /\b(who|which|list|show)\b/i.test(message));

  const metrics: OverviewMetric[] = [];
  let unsupported = false;
  let countedNoun: string | null = null;
  if (counting && !specialists && !staff) {
    for (const [metric, re] of METRIC_NOUNS)
      if (re.test(message)) metrics.push(metric);
    if (
      !metrics.length &&
      GENERIC_PATIENTS.test(message) &&
      !QUANTITY_NOUNS.test(message) &&
      extractPatientIds(message).length === 0
    )
      metrics.push('patients');
    // a quantity (hours, mg, times...) or a count about one named patient is a policy/chart question, not a hospital count
    const aboutOnePatient = extractPatientIds(message).length > 0;
    if (!metrics.length && !QUANTITY_NOUNS.test(message) && !aboutOnePatient) {
      unsupported = true;
      const m = message.match(
        /(?:how many|number of|count of|total (?:number|count)(?: of)?)\s+(?:the\s+)?([a-z][a-z -]{1,30}?)(?:\s+(?:are|is|do|does|did|were|was|have|has|in|at|on|available|there|we)\b|[?.!,]|$)/i,
      );
      countedNoun = m?.[1]?.trim() ?? null;
    }
  }
  const overview =
    !specialists &&
    !staff &&
    !unsupported &&
    (OVERVIEW_WORDS(message) || (counting && metrics.length > 0));
  const policy = POLICY(message);
  return {
    write: action,
    medication: MEDICATION(message),
    triage: TRIAGE(message),
    list,
    waiting,
    overview,
    policy,
    crossSearch: CROSS(message) && !list && !waiting && !overview && !policy,
    review,
    specialists,
    staff,
    metrics: overview ? metrics : [],
    unsupported,
    countedNoun,
  };
}

/** Patient ids written in a message: seeded (P1001) or generated (P + 6 unambiguous characters). */
export function extractPatientIds(message: string): string[] {
  const found = new Set<string>();
  for (const m of message.matchAll(/\bP\d{4}\b/gi))
    found.add(m[0].toUpperCase());
  for (const m of message.matchAll(/\bP[A-HJ-NP-Z2-9]{6}\b/g)) found.add(m[0]);
  return [...found];
}
