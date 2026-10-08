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
}

const rx = (s: RegExp) => (t: string) => s.test(t);

const WRITE = rx(
  /\b(book|schedule|register|admit|prescribe|record|create|add|assign|cancel|close|delete|remove|update|order|discharge|refer|referral|notify|propose|arrange|escalate|transfer|follow[- ]?up plan)\b/i,
);
const LIST = rx(
  /\b(all|every|each)\b[^.?!]*\bpatients?\b|\blist\b[^.?!]*\bpatients?\b|\bpatients?\b[^.?!]*\b(list|registered|in the (hospital|system|database))\b|\bpatient details\b/i,
);
const WAITING = rx(
  /\bwaiting\b|\bqueue\b|\bunconsulted\b|\bnot (yet )?(been )?seen\b/i,
);
const OVERVIEW = rx(
  /\b(how many|count|number of|overview|statistics|stats|dashboard|total (number|count|patients?))\b/i,
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
  // "how many specialists" is about staff, not about the patient overview
  const specialists =
    SPECIALISTS(message) &&
    !review &&
    !WRITE(message) &&
    !/\bpatients?\b/i.test(message);
  const overview = OVERVIEW(message) && !specialists;
  const policy = POLICY(message);
  return {
    write: WRITE(message),
    medication: MEDICATION(message),
    triage: TRIAGE(message),
    list,
    waiting,
    overview,
    policy,
    crossSearch: CROSS(message) && !list && !waiting && !overview && !policy,
    review,
    specialists,
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
