import type { Entity, OverviewMetric } from './query-plan';

/**
 * The words the parser understands, as TABLES (data), so adding "radiology" or "beds" is one row, not new control flow.
 * Wording belongs here; meaning belongs in the QueryPlan.
 */

/** Words naming a thing in the hospital -> the entity they refer to (first match in a table wins per row). */
export const ENTITY_WORDS: Array<[Entity, RegExp]> = [
  [
    'SPECIALIST',
    /\b(specialists?|consultants?|cardiologists?|neurologists?)\b/i,
  ],
  [
    'STAFF',
    /\b(doctors?|docs?|drs?|physicians?|nurses?|pharmacists?|radiologists?|receptionists?|coordinators?|staff|employees)\b/i,
  ],
  ['REFERRAL', /\b(referrals?|referred)\b/i],
  ['APPOINTMENT', /\b(appointments?|bookings?|slots?)\b/i],
  ['TASK', /\b(tasks?|to-?dos?)\b/i],
  [
    'LAB',
    /\b(labs?|lab results?|blood tests?|results?|troponin|hba1c|creatinine|glucose)\b/i,
  ],
  [
    'VITALS',
    /\b(vitals?|blood pressure|heart rate|pulse|temperature|spo2|saturation|news2)\b/i,
  ],
  [
    'MEDICATION',
    /\b(medic\w*|meds?|prescri\w*|drugs?|tablets?|pills?|dose|dosage|insulin|aspirin|gave|given|did\b[^.?!]*\bgive)\b/i,
  ],
  ['ALLERGY', /\b(allerg\w*)\b/i],
  ['CONDITION', /\b(conditions?|diagnos\w*|history|comorbid\w*)\b/i],
  ['IMAGING', /\b(imaging|scans?|x-?rays?|mri|ct|ultrasound|radiolog\w*)\b/i],
  [
    'QUEUE',
    /\b(waiting|waited|queue|unconsulted|not (?:yet )?(?:been )?seen)\b/i,
  ],
  ['VISIT', /\b(visits?|admissions?|episodes?)\b/i],
  [
    'POLICY',
    /\b(polic(?:y|ies)|protocols?|procedures?|sops?|guidelines?|standard operating|criteria|handbook|escalation|code word|visiting hours|documents?|thresholds?|red alerts?|cut-?offs?)\b/i,
  ],
  ['PATIENT', /\b(patients?|people)\b/i],
];

/** Which hospital figure answers a count about each thing (specific beats generic "patients"). */
export const METRIC_PATTERNS: Array<[OverviewMetric, RegExp]> = [
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

/** Staff role words -> the role they name (singular stem). */
export const ROLE_WORDS: Array<[string, RegExp]> = [
  ['DOCTOR', /\b(doctors?|physicians?)\b/i],
  ['NURSE', /\bnurses?\b/i],
  ['PHARMACIST', /\bpharmacists?\b/i],
  ['RADIOLOGIST', /\bradiologists?\b/i],
  ['RECEPTIONIST', /\breceptionists?\b/i],
  ['CARE_COORDINATOR', /\bcoordinators?\b/i],
  ['SPECIALIST', /\bspecialists?\b/i],
];

/**
 * Everyday words for a specialty (what a nurse says: "heart", "stroke"). Keyed by the specialty NAME as stored on the
 * specialist accounts; a specialty with no row here is still recognised by its own name ("Cardiology", "cardiologist").
 */
export const SPECIALTY_SYNONYMS: Record<string, RegExp> = {
  Cardiology:
    /\b(heart|cardiac|cardio\w*|chest pain|angina|arrhythmia|palpitations?|myocardial)\b/i,
  Neurology:
    /\b(brain|neuro\w*|stroke|seizures?|epilep\w*|migraine|headache|dizz\w*|numbness)\b/i,
};

export const GREETING =
  /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|thanks?|thank you|ok thanks?|okay thanks?|cheers|bye|goodbye|what can you do|who are you|help|how are you)\b[\s!.?]*$/i;

/** "no / cancel" as a reply, judged on short messages only (confirmations: see PURE_CONFIRM). */
export const DECLINE_WORDS =
  /^(?:no|nope|nah|cancel|stop|never ?mind|don'?t(?: do (?:it|that))?|do not(?: do (?:it|that))?|decline|reject|abort|forget it|wrong)\b/i;

/**
 * A confirmation is the WHOLE message ("yes", "confirm", "go ahead and book it", "confirm ACT12345A"): extra content
 * means the user is saying something else ("yes, what are his labs?").
 */
export const PURE_CONFIRM =
  /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|correct|that'?s right|confirm(?:ed)?|approve(?:d)?|go ahead(?: and \w+(?: it| that)?)?|proceed|do it|please do|yes,? please)(?:\s*,?\s*(?:go ahead|please|do it|confirm|proceed|approve))?(?:\s+ACT[A-Z0-9]{8})?[\s.!]*$/i;
/** Acknowledgements that read as agreement but never approve anything on their own. */
export const WEAK_CONFIRM =
  /^(?:sure|ok(?:ay)?|correct|that'?s right)[\s.!]*$/i;
export function isPureConfirm(message: string): boolean {
  return PURE_CONFIRM.test(message.trim());
}

/** A change request starts with one of these verbs (see `isActionRequest`). */
export const ACTION_VERBS =
  'book|schedule|reschedule|register|admit|prescribe|record|create|add|assign|cancel|close|reopen|delete|remove|' +
  'update|order|discharge|refer|notify|remind|propose|arrange|escalate|transfer|send|enter|log|complete|set up|write|' +
  'change|modify|grant|revoke';
export const POLITE_PREFIX =
  /^(?:(?:hi|hello|hey|ok|okay|so|and|then|now|also)[,!. ]+)*(?:(?:please|kindly)[, ]+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s*(?:'d|\s+would)?\s*(?:like|want|need)\s+(?:you\s+)?to\s+|i\s+need\s+you\s+to\s+|let'?s\s+|go\s+ahead\s+and\s+)?/i;
// "update on", "record of/for", "order status" are nouns here, not commands
export const ACTION_START = new RegExp(
  `^(?!remind\\s+me\\b)(?:${ACTION_VERBS})\\b(?!\\s+(?:on|of|for|about|status|history|policy|in|since|over)\\b)`,
  'i',
);
export const FOLLOW_UP_PLAN =
  /^generate\b[^.?!]*\b(follow[- ]?up|referral|order|task|plan)\b/i;

/** Frames: the SHAPE of a question. */
export const COUNT_FRAME =
  /\b(how many|(?<!phone )(?<!contact )(?<!telephone )(?<!mobile )number of|count of|total (?:number|count)(?: of)?|count)\b|\b(?:do we have|are there|is there)\s+(?:any|an?|some)\b|\bany\s+(?:[a-z]+\s+)?(?:available|on duty|working)\b/i;
export const LIST_FRAME =
  /\b(all|list|show (?:me )?(?:all|every|the)|who (?:are|is|were)|which|name (?:the|all)|give me (?:a |the )?(?:list|names)|all the|every|each)\b/i;
export const LOOKUP_FRAME =
  /\b(details?|info(?:rmation)?|show|get|tell me about|what(?:'s| is| are| was| were)|when|summary|summarise|summarize|chart|record|profile)\b/i;
export const OWNERSHIP_SHAPE =
  /\b(who (?:handles?|is responsible|is in charge|decides|approves|signs|owns|covers|can see|should see|sees)|in charge of|responsible for|who do (?:i|we) (?:call|contact|ask|send))\b/i;
export const REVIEW_FRAME =
  /\b(review|recommend\w*|should (?:i|we) refer|(?:is|are) (?:a )?(?:specialists?|referrals?) (?:required|needed|necessary)|should \w+(?: \w+)? (?:see|be seen by|be referred to|go to) (?:a|an|the)? ?(?:specialist|cardiologist|neurologist)|does \w+(?: \w+)* need (?:a )?referral|needs? (?:a )?specialist|requires? (?:a )?specialist|specialist (?:required|needed|necessary))\b/i;
// Drug SAFETY / dosing questions. "what did the doctor give him" is a chart lookup, not a safety question.
export const MEDICATION_SAFETY =
  /\b((?<!\b(?:did|does|do|has|have|was|were)\b[^.?!]{0,30})prescrib(?:e|ing)|safe|safely|interaction|interactions|contraindicat\w*|dosage|dose|administer|start(?:ing)? (?:on|him|her|them))\b|\b(?:can|could|should|may|shall|ok(?:ay)? to|safe to)\s+(?:i|we)?\s*(?:give|giving)\b/i;
/** A staff word used as the OBJECT of a waiting/seeing phrase ("waiting for a doctor") names no staff question. */
export const ROLE_AS_OBJECT =
  /\b(?:for|with|to see|see|seen by|by|from)\s+(?:a|an|the|my|our)\s+(?:doctors?|physicians?|nurses?|specialists?|pharmacists?|radiologists?)\b/gi;
/** "staff tasks", "staff appointments": the word "staff" describes the thing counted; it is not a question about staff. */
export const STAFF_AS_MODIFIER =
  /\bstaff(?=\s+(?:tasks?|to-?dos?|appointments?|bookings?|schedules?|notifications?|alerts?))/gi;
export const REASONING =
  /\b(why|should|shall|concern\w*|risk\w*|compare|recommend\w*|interaction\w*|explain|unusual|abnormal|worr\w*|better|worse|trend\w*|likely|could|would|can (?:we|i|he|she)|is it|are they|suggest\w*|advice|next step|what if|prognosis)\b/i;
export const CROSS_SEARCH =
  /\b(which|who)\b[^.?!]*\b(patients?|has|have|had|on|taking|allergic|diagnosed|suffering|complain)/i;

/** "how many hours / mg / times": a VALUE inside a rule or a chart, never a head-count. */
export const QUANTITY_NOUNS =
  /\b(?:how many|number of)\s+(?:more\s+|extra\s+)?(?:hours?|minutes?|mins?|days?|weeks?|months?|years?|mg|mcg|ml|doses?|times|tablets?|pills?|units?|steps?|levels?|points?|signatures?|approvals?|attempts?|readings?|labs?|results?|medications?|drugs?|allergies|conditions|visits?\s+(?:has|have|did|does))\b/i;

/** A question about the conversation itself ("what were we looking at again?"): answered from the thread by the model, not from records. */
export const CONVERSATION_RECALL =
  /\b(?:what|where|which)\b[^.?!]*\b(?:we|you|i)\b[^.?!]*\b(?:said|discuss(?:ed)?|looking at|talking about|talked about|asked|mentioned|covered|were doing)\b|\b(?:as|like) (?:we|i|you) (?:said|discussed|mentioned)\b|\bremind me\b|\bearlier\b|\bagain\b[^.?!]*\?$/i;

/**
 * The question asks what a RULE requires ("must", "required", "how long before they can...", "needs approval"), as opposed to
 * asking for facts about one patient. With no particular patient named, it is a policy question even when it uses no
 * word like "policy" or "protocol".
 */
export const RULE_SHAPE =
  /\b(?:who|what)\s+(?:verif\w*|checks?|confirms?)\b|\bbefore (?:giving|administering|discharg\w*|prescrib\w*|starting|releasing)\b|\bwhat(?:'s| is| are) the (?:rules?|requirements?|process|procedure|criteria|threshold|limits?|protocol|steps?)\b|\b(?:requirements?|rules?|criteria|thresholds?|double[- ]?check(?:s|ed)?|trigger(?:s|ed)?)\b|\b(?:can|may|could)\s+(?:one|a|an|the|any)\s+(?:nurse|doctor|physician|pharmacist|receptionist|staff|person|clinician)\b|\bshould (?:trigger|be (?:given|avoided|used|checked|logged|escalated|reported)|we|nurses?|doctors?|staff)\b|\bwhich (?:antibiotics?|drugs?|medications?|medicines?) (?:can|should|must|may)\b|\bat what (?:level|value|point|threshold|score|rate|temperature|pressure|number|time|stage)\b|\b(must|have to|has to|need(?:s)? to|needed|necessary|required|requires?|allowed|permitted|supposed to|obliged|mandatory|compulsory)\b|\bhow (?:long|soon|often|far ahead|quickly|early|late|many hours|many days) (?:must|should|can|do|does|is|are)\b|\bwhat (?:should|do) (?:i|we|you|staff|nurses?|doctors?) do\b|\bwhat happens (?:when|if|to)\b|\bneeds? (?:any|an|a|some)?\s*(?:approval|sign[- ]?off|clearance|permission|authori[sz]ation)\b|\b(?:approval|sign[- ]?off|clearance|permission|authori[sz]ation|supervis\w*)\b/i;

/** Wording that asks what a rule/guideline says even when a specialty is named ("...should trigger a neurology referral"). */
export const RULE_STRONG =
  /\b(?:must|have to|has to|required|requirements?|mandatory|should trigger|triggers?|criteria|thresholds?|sign[- ]?off|double[- ]?check(?:s|ed)?|what happens (?:when|if|to)|what do we do)\b/i;

/** "a patient", "any patient", "every patient": patients in general, not one in the conversation. */
export const GENERIC_PATIENT =
  /\b(?:a|an|any|every|each|per|one|another|some|all)\s+patients?(?:'s|s')?|\b(?:if|when|whenever|once|after|before|unless|while)\s+the\s+patients?\b|\bthe\s+patient\s+(?:identity|identification|id|wristband|consent|safety)\b/gi;
/** "how many X MUST/SHOULD ...": the number inside a requirement, not a head-count. */
export const REQUIREMENT_MODAL =
  /\b(must|should|have to|has to|need(?:s)? to|required to|supposed to|obliged to)\b/i;

/**
 * A question about HOW LONG people have waited ("who has waited longest", "the patient waiting for a long time",
 * "waiting more than 3 hours", "waiting since yesterday"): the waiting list ranked by wait time, not a count.
 */
export const LONGEST_WAIT =
  /\b(?:longest|most time|the most)\b|\bwait(?:ed|ing)?\b[^.?!]*\b(?:long(?:er)? time|ages|forever|too long|\d+\s*(?:min(?:ute)?s?|hours?|hrs?|days?)|(?:past|over|more than|since)\s+(?:a|an|one|two|\d+|yesterday|this morning))\b/i;
