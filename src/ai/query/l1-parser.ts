import { editDistance } from '../../hospital/mention-matching';
import {
  ACTION_START,
  COUNT_FRAME,
  isPureConfirm,
  CONVERSATION_RECALL,
  CROSS_SEARCH,
  DECLINE_WORDS,
  ENTITY_WORDS,
  FOLLOW_UP_PLAN,
  GREETING,
  LIST_FRAME,
  LOOKUP_FRAME,
  MEDICATION_SAFETY,
  METRIC_PATTERNS,
  OWNERSHIP_SHAPE,
  POLITE_PREFIX,
  ROLE_AS_OBJECT,
  STAFF_AS_MODIFIER,
  QUANTITY_NOUNS,
  REASONING,
  RULE_SHAPE,
  RULE_STRONG,
  LONGEST_WAIT,
  GENERIC_PATIENT,
  REQUIREMENT_MODAL,
  REVIEW_FRAME,
  ROLE_WORDS,
  SPECIALTY_SYNONYMS,
} from './lexicon';
import {
  emptyPlan,
  type Hints,
  type Entity,
  type Intent,
  type OverviewMetric,
  type QueryPlan,
  type Vocabulary,
} from './query-plan';

/** Words whose misspelling we repair: the vocabulary of questions, never names. */
const TYPO_KEYWORDS = [
  'many',
  'number',
  'count',
  'total',
  'patients',
  'patient',
  'people',
  'specialists',
  'specialist',
  'cardiologists',
  'cardiologist',
  'neurologists',
  'neurologist',
  'doctors',
  'nurses',
  'pharmacists',
  'radiologists',
  'appointments',
  'appointment',
  'available',
  'waiting',
  'queue',
  'policy',
  'policies',
  'protocol',
  'procedure',
  'guideline',
  'guidelines',
  'medications',
  'medication',
  'allergies',
  'vitals',
  'referral',
  'details',
  'today',
  'tomorrow',
  'overview',
  'statistics',
  'list',
  'every',
  'schedule',
  'discharge',
  'register',
  'refer',
  'tasks',
  'labs',
];

function transposed(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i++)
    if (a[i] !== b[i])
      return (
        a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2)
      );
  return false;
}

/** Repairs misspelt QUESTION words ("mnay" -> "many", "specialits" -> "specialists") using the lexicon plus the specialties in the data. */
export function normalizeTypos(text: string, vocab: Vocabulary): string {
  const keywords = new Set([
    ...TYPO_KEYWORDS,
    ...vocab.specialties.map((s) => s.toLowerCase()),
  ]);
  return text.replace(/\b[A-Za-z]{4,}\b/g, (word) => {
    const w = word.toLowerCase();
    if (keywords.has(w)) return word;
    const scored = [...keywords]
      .filter(
        (k) =>
          k[0] === w[0] &&
          Math.abs(k.length - w.length) <= 2 &&
          // "doctor" vs "doctors" is a different word form, not a typo
          !k.startsWith(w) &&
          !w.startsWith(k),
      )
      .map((k) => ({
        k,
        d: transposed(w, k) ? 1 : editDistance(w, k),
        swap: transposed(w, k),
      }))
      // 4-letter words are only repaired when two neighbouring letters were swapped ("mnay"); longer ones by edit distance
      .filter(({ d, swap }) =>
        w.length <= 4 ? swap : d <= (w.length >= 8 ? 2 : 1),
      )
      .sort((a, b) => a.d - b.d);
    const best = scored[0];
    if (!best) return word;
    const tied = scored.filter((x) => x.d === best.d);
    // singular/plural of the same keyword ("specialist"/"specialists") is one candidate, not two
    const sameWord = tied.every(
      (x) => x.k.startsWith(tied[0].k) || tied[0].k.startsWith(x.k),
    );
    if (tied.length === 1 || sameWord)
      return tied.sort(
        (x, y) =>
          Math.abs(x.k.length - w.length) - Math.abs(y.k.length - w.length),
      )[0].k;
    return word; // never repair when two different keywords are equally close
  });
}

/** Patient ids written in a message: seeded (P1001) or generated (P + 6 unambiguous characters). */
export function extractPatientIds(message: string): string[] {
  const found = new Set<string>();
  for (const m of message.matchAll(/\bP\d{4}\b/gi))
    found.add(m[0].toUpperCase());
  for (const m of message.matchAll(/\bP[A-HJ-NP-Z2-9]{6}\b/g)) found.add(m[0]);
  return [...found];
}

/** Pronouns that point back at the patient the conversation is about. */
export const PRONOUN_REF =
  /\b(he|him|his|she|her|hers|they|them|their|the patient|that patient|this patient|same patient|patient's)\b/i;

/** True when the message asks for a CHANGE: a clause that starts with a verb ("please refer him...", "can you book..."). */
export function isActionRequest(message: string): boolean {
  const text = message.trim();
  if (isPureConfirm(text)) return true;
  return text
    .split(/(?:[.;!?]|,|\band\b|\bthen\b)\s*/i)
    .map((seg) => seg.trim().replace(POLITE_PREFIX, ''))
    .some((seg) => ACTION_START.test(seg) || FOLLOW_UP_PLAN.test(seg));
}

const TRIAGE_WORDS = [
  /\b(hr|heart rate|pulse)\b/i,
  /\b(bp|blood pressure|systolic)\b/i,
  /\b(spo2|sats?|saturation|oxygen)\b/i,
  /\b(temp|temperature)\b/i,
  /\b(rr|resp(iratory)? rate|breathing)\b/i,
];
// Vital-sign VALUES in the message (numbers that are not part of a patient id or a date)
const valuesIn = (t: string) =>
  (
    t
      .replace(/\b(?:news2|spo2)\b/gi, ' ')
      .replace(/\bP[A-Z0-9]{4,6}\b/gi, ' ')
      .replace(/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/g, ' ')
      .match(/\d+(?:\.\d+)?/g) ?? []
  ).length;
const isCalculation = (t: string) =>
  valuesIn(t) >= 1 &&
  (/\b(news2|triage|vitals?)\b/i.test(t) ||
    TRIAGE_WORDS.filter((r) => r.test(t)).length >= 3);

interface Candidate {
  intent: Intent;
  entity: Entity;
  confidence: number;
  evidence: string;
  patch?: (p: QueryPlan) => void;
}

/** The specialty a message names (by name or by everyday word), from the specialties that really exist. */
function specialtyIn(message: string, vocab: Vocabulary): string | undefined {
  const lower = message.toLowerCase();
  for (const sp of vocab.specialties) {
    const stem = sp
      .toLowerCase()
      .replace(/(y|ist|ists|ies)$/i, '')
      .slice(0, 6);
    const byName =
      stem.length >= 4 && new RegExp(`\\b${stem}\\w*`, 'i').test(lower);
    const bySynonym = SPECIALTY_SYNONYMS[sp]?.test(message) ?? false;
    if (byName || bySynonym) return sp;
  }
  return undefined;
}

/** Every thing the message names, in table order. */
export function entitiesIn(message: string): Entity[] {
  return ENTITY_WORDS.filter(([, re]) => re.test(message)).map(([e]) => e);
}

/**
 * L1: a deterministic parser. It never "matches a question"; it fills in a plan: the SHAPE of the question (frames),
 * the THINGS it names (entities), who/what it is about (scope, patient reference), and scores each plausible reading.
 * The best reading becomes the plan; close rivals become `alternatives` and lower the confidence, which is what lets
 * the router ask instead of guess.
 */
/** Evidence marker: a message of up to three words that matched nothing ("list", "what is the"). */
export const SHORT_FRAGMENT = 'short fragment, nothing recognised';

export function parseQuery(
  message: string,
  vocab: Vocabulary = { specialties: [] },
  hints: Hints = {},
): QueryPlan {
  // typos in the QUESTION WORDS ("how mnay", "specialits") are repaired against the known vocabulary; names are left alone
  const text = normalizeTypos(message.trim(), vocab);
  const plan = emptyPlan();
  const words = text.split(/\s+/).filter(Boolean).length;
  const ids = extractPatientIds(text);
  plan.patientRef = ids.length
    ? { kind: 'ID', value: ids[0] }
    : hints.person === 'PATIENT' || hints.person === 'AMBIGUOUS'
      ? { kind: 'NAME' }
      : // "before THEY can go home" after "a patient" is about patients in general, not the one in the conversation
        PRONOUN_REF.test(text.replace(GENERIC_PATIENT, ' ')) &&
          !new RegExp(GENERIC_PATIENT.source, 'i').test(text)
        ? { kind: 'PRONOUN' }
        : { kind: 'NONE' };
  const hasPatient = plan.patientRef.kind !== 'NONE';

  // "waiting for a doctor" / "with a doctor": the doctor is where the patient is going, not what is being asked about
  const entities = entitiesIn(
    text.replace(ROLE_AS_OBJECT, ' ').replace(STAFF_AS_MODIFIER, ' '),
  );
  const specialty = specialtyIn(text, vocab);
  const roleHit = ROLE_WORDS.find(([, re]) =>
    re.test(text.replace(ROLE_AS_OBJECT, ' ').replace(STAFF_AS_MODIFIER, ' ')),
  )?.[0];
  const metrics = METRIC_PATTERNS.filter(([, re]) => re.test(text)).map(
    ([m]) => m,
  );
  // "how many nurses MUST check insulin" asks for a requirement inside a rule, not for a head-count
  const requirement =
    COUNT_FRAME.test(text) &&
    !hasPatient &&
    (REQUIREMENT_MODAL.test(text) || entities.includes('POLICY'));
  const counting = COUNT_FRAME.test(text) && !requirement;
  const listing = LIST_FRAME.test(text);
  const actionish = isActionRequest(text) && !isPureConfirm(text);
  // a lone verb ("cancel", "book") has no object: it is a reply to something, or an unfinished request
  const bareVerb = actionish && words <= 2 && !entities.length && !hasPatient;
  const action = actionish && !bareVerb;
  const cands: Candidate[] = [];
  const add = (c: Candidate) => cands.push(c);

  // ---- conversational turns --------------------------------------------------------------------------------------
  if (GREETING.test(text))
    add({
      intent: 'SMALLTALK',
      entity: 'NONE',
      confidence: 0.95,
      evidence: 'greeting / help request',
    });
  if (words <= 7 && isPureConfirm(text))
    add({
      intent: 'CONFIRM',
      entity: 'NONE',
      confidence: 0.9,
      evidence: 'short affirmative reply',
    });
  if (words <= 6 && DECLINE_WORDS.test(text) && !entities.length)
    add({
      intent: 'DECLINE',
      entity: 'NONE',
      confidence: 0.9,
      evidence: 'short negative reply',
    });

  // ---- calculation from numbers in the message ----------------------------------------------------------------
  if (isCalculation(text))
    add({
      intent: 'CALCULATE',
      entity: 'VITALS',
      confidence: 0.9,
      evidence: 'vital-sign values in the message',
    });

  if (bareVerb && DECLINE_WORDS.test(text))
    add({
      intent: 'DECLINE',
      entity: 'NONE',
      confidence: 0.9,
      evidence: 'a lone negative verb',
    });
  else if (bareVerb)
    add({
      intent: 'ACTION',
      entity: 'NONE',
      confidence: 0.45,
      evidence: 'a verb with nothing to act on',
    });

  // ---- a change request ----------------------------------------------------------------------------------------
  if (action) {
    const object =
      entities.find((e) => !['PATIENT', 'POLICY', 'QUEUE'].includes(e)) ??
      entities[0] ??
      'NONE';
    add({
      intent: 'ACTION',
      entity: object,
      confidence: 0.92,
      evidence: 'message starts with a change verb',
    });
  }

  // ---- a definition / explanation question with no patient: the agent explains (no data to look up)
  if (
    !action &&
    !hasPatient &&
    /\b(what does .* mean|define|explain|what is meant by|difference between)\b/i.test(
      text,
    )
  )
    add({
      intent: 'CLINICAL_QUESTION',
      entity: 'NONE',
      confidence: 0.8,
      evidence: 'asks for an explanation',
    });

  // ---- is a specialist needed? ---------------------------------------------------------------------------------
  const reviewShape =
    REVIEW_FRAME.test(text) ||
    (/\b(need|needs|needed|require[sd]?|required|necessary|should (?:i|we) (?:refer|send)|refer(?:ral)? (?:needed|required))\b/i.test(
      text,
    ) &&
      (entities.includes('SPECIALIST') || !!specialty));
  if (reviewShape && !action)
    add({
      intent: 'CLINICAL_REVIEW',
      entity: 'REFERRAL',
      confidence: hasPatient ? 0.9 : 0.7,
      evidence: 'asks for a specialist review',
    });

  // ---- counts ---------------------------------------------------------------------------------------------------
  if (counting && !action) {
    const quantity = QUANTITY_NOUNS.test(text);
    if (entities.includes('SPECIALIST') || specialty) {
      add({
        intent: 'COUNT',
        entity: 'SPECIALIST',
        confidence: 0.92,
        evidence: 'count frame + specialist/specialty',
      });
    } else if (entities.includes('STAFF')) {
      add({
        intent: 'COUNT',
        entity: 'STAFF',
        confidence: 0.92,
        evidence: 'count frame + staff role',
      });
    } else if (quantity && hasPatient) {
      add({
        intent: 'LOOKUP',
        entity: entities[0] ?? 'PATIENT',
        confidence: 0.82,
        evidence: 'a count about one patient',
      });
    } else if (quantity) {
      // "how many hours must vitals be stable" is a value inside a rule
      add({
        intent: 'POLICY_QUERY',
        entity: 'POLICY',
        confidence: 0.8,
        evidence: 'quantity inside a rule',
      });
    } else if (hasPatient && entities.some((e) => e !== 'PATIENT')) {
      add({
        intent: 'LOOKUP',
        entity: entities.find((e) => e !== 'PATIENT')!,
        confidence: 0.8,
        evidence: 'a count about one patient',
      });
    } else if (
      metrics.length ||
      entities.includes('PATIENT') ||
      entities.includes('VISIT')
    ) {
      add({
        intent: 'COUNT',
        entity: metrics.length ? metricEntity(metrics[0]) : 'PATIENT',
        confidence: 0.92,
        evidence: 'count frame + a figure the hospital keeps',
        patch: (p) => {
          p.filters.metrics = metrics.length
            ? metrics
            : (['patients'] as OverviewMetric[]);
        },
      });
    } else if (countedNounOf(text)) {
      add({
        intent: 'COUNT',
        entity: 'OTHER',
        confidence: 0.85,
        evidence: 'count frame + something not recorded',
      });
    } else {
      // "how many?" with nothing counted: ask what to count
      add({
        intent: 'COUNT',
        entity: 'NONE',
        confidence: 0.4,
        evidence: 'count frame without a subject',
      });
    }
  }
  if (/\b(overview|statistics|stats|dashboard)\b/i.test(text) && !action)
    add({
      intent: 'COUNT',
      entity: 'PATIENT',
      confidence: 0.9,
      evidence: 'asks for the overview',
      patch: (p) => {
        p.filters.metrics = [];
      },
    });

  // ---- staff and specialist lists ------------------------------------------------------------------------------
  const whoFrame = /\b(who|which|list|show|name)\b/i.test(text);
  const isReferralQuestion =
    entities.includes('REFERRAL') || /\brefer/i.test(text);
  if (
    !counting &&
    !action &&
    !isReferralQuestion &&
    ((entities.includes('SPECIALIST') && !entities.includes('PATIENT')) ||
      (specialty &&
        (OWNERSHIP_SHAPE.test(text) ||
          (whoFrame && !entities.includes('PATIENT')))))
  )
    add({
      intent: 'LIST',
      entity: 'SPECIALIST',
      confidence: 0.88,
      evidence: 'who/list + specialist or specialty',
    });
  if (
    !action &&
    !counting &&
    isReferralQuestion &&
    !entities.includes('POLICY')
  )
    add({
      intent: 'LIST',
      entity: 'REFERRAL',
      confidence: 0.88,
      evidence: 'asks about patient referrals / referred patients',
    });
  if (
    !counting &&
    !action &&
    entities.includes('STAFF') &&
    whoFrame &&
    !hasPatient &&
    !specialty && // "doctors in cardiology" asks for the specialists of that specialty
    !entities.includes('PATIENT')
  )
    add({
      intent: 'LIST',
      entity: 'STAFF',
      confidence: 0.88,
      evidence: 'who/list + staff role',
    });

  // ---- the waiting room -------------------------------------------------------------------------------------------
  if (!action && !counting && entities.includes('QUEUE'))
    add({
      intent: 'LIST',
      entity: 'QUEUE',
      confidence: 0.88,
      evidence: 'asks about waiting / the queue',
    });
  if (counting && entities.includes('QUEUE')) {
    // "how many are waiting": the count (above) already carries the metric; also keep the queue list as a reading
    add({
      intent: 'LIST',
      entity: 'QUEUE',
      confidence: 0.4,
      evidence: 'could want the people, not the number',
    });
  }

  if (requirement && !action)
    add({
      intent: 'POLICY_QUERY',
      entity: 'POLICY',
      confidence: 0.9,
      evidence: 'a number inside a requirement',
    });

  // ---- a question about what a rule requires, with no particular patient (even without the word "policy") -------
  if (
    !action &&
    !counting &&
    !hasPatient &&
    hints.person !== 'PATIENT' &&
    RULE_SHAPE.test(text) &&
    (!entities.includes('SPECIALIST') || RULE_STRONG.test(text))
  )
    add({
      intent: 'POLICY_QUERY',
      entity: 'POLICY',
      // a rule-shaped question about no particular patient outranks the generic readings its nouns produce
      // ("antibiotics ... allergic" -> allergy lookup, "emergency patient" -> patient list)
      confidence: RULE_STRONG.test(text) ? 0.99 : 0.92,
      evidence: 'asks what a rule requires (no particular patient)',
    });

  // ---- policy / rules ------------------------------------------------------------------------------------------------
  const ownership = OWNERSHIP_SHAPE.test(text) && !specialty && !hasPatient;
  if (
    !action &&
    (entities.includes('POLICY') || ownership) &&
    !(counting && !QUANTITY_NOUNS.test(text))
  )
    add({
      intent: 'POLICY_QUERY',
      entity: 'POLICY',
      confidence: entities.includes('POLICY') ? 0.88 : 0.7,
      evidence: entities.includes('POLICY')
        ? 'names a policy/protocol/guideline'
        : 'asks who is responsible',
    });

  // ---- patients: lists, searches, lookups ---------------------------------------------------------------------
  const cross =
    CROSS_SEARCH.test(text) &&
    !entities.includes('SPECIALIST') &&
    !entities.includes('STAFF') &&
    !entities.includes('QUEUE') &&
    !OWNERSHIP_SHAPE.test(text) &&
    !hasPatient;
  if (
    !action &&
    !counting &&
    listing &&
    entities.includes('PATIENT') &&
    !entities.includes('QUEUE') &&
    !hasPatient &&
    !cross
  )
    add({
      intent: 'LIST',
      entity: 'PATIENT',
      confidence: 0.9,
      evidence: 'list/all + patients',
    });
  if (!action && !counting && cross)
    add({
      intent: 'LIST',
      entity: 'PATIENT',
      confidence: 0.9,
      evidence: 'which/who has ... (search across records)',
      patch: (p) => {
        p.filters.search = true;
      },
    });
  if (!action && MEDICATION_SAFETY.test(text))
    add({
      intent: 'CLINICAL_QUESTION',
      entity: 'MEDICATION',
      confidence: 0.9,
      evidence: 'drug safety/dosing wording',
      patch: (p) => {
        p.filters.safety = true;
      },
    });
  const sectionEntities = entities.filter((e) =>
    [
      'LAB',
      'VITALS',
      'MEDICATION',
      'ALLERGY',
      'CONDITION',
      'IMAGING',
      'APPOINTMENT',
      'REFERRAL',
    ].includes(e),
  );
  // a staff member was named ("who is Dr. Sarah Wilson"): facts about a person on the staff
  if (hints.person === 'STAFF' && !action && !counting)
    add({
      intent: 'LOOKUP',
      entity: 'STAFF',
      confidence: 0.88,
      evidence: 'names a member of staff',
    });

  // a question about the conversation itself goes to the model, which has the thread
  const recall =
    CONVERSATION_RECALL.test(text) &&
    !hasPatient &&
    !entities.some((e) => e !== 'PATIENT' && e !== 'NONE');
  if (recall && !action)
    add({
      intent: 'UNKNOWN',
      entity: 'NONE',
      confidence: 0.6,
      evidence: 'refers back to the conversation',
    });
  if (
    !action &&
    !counting &&
    !recall &&
    (hasPatient || sectionEntities.length || LOOKUP_FRAME.test(text)) &&
    !entities.includes('POLICY')
  ) {
    const reasoning = REASONING.test(text);
    add({
      intent: reasoning ? 'CLINICAL_QUESTION' : 'LOOKUP',
      entity: sectionEntities[0] ?? 'PATIENT',
      // facts about a patient need a patient: named, in the conversation, or at least a section asked about; a bare
      // "what is ..." with nothing to look up is not a lookup
      confidence: hasPatient
        ? 0.86
        : sectionEntities.length
          ? 0.7
          : /\b(?:about|for|of|on|regarding)\s+[A-Z][a-z]+/.test(message)
            ? 0.6
            : 0.4,
      evidence: reasoning
        ? 'asks for reasoning about a patient'
        : 'asks for facts (about a patient)',
    });
  }

  // ---- pick the best reading; rivals become alternatives -------------------------------------------------------
  cands.sort((a, b) => b.confidence - a.confidence);
  const best = cands[0];
  if (!best) {
    plan.confidence = 0.1;
    plan.evidence = [words <= 3 ? SHORT_FRAGMENT : 'no recognisable intent'];
    return plan;
  }
  plan.intent = best.intent;
  plan.entity = best.entity;
  plan.confidence = best.confidence;
  plan.evidence = [best.evidence];
  // a tiny message that only weakly resembles a question ("what is the") is a fragment, not a request
  if (words <= 3 && best.confidence < 0.5) plan.evidence.push(SHORT_FRAGMENT);
  plan.alternatives = cands
    .slice(1, 5)
    .filter((c) => !(c.intent === best.intent && c.entity === best.entity))
    .map((c) => ({
      intent: c.intent,
      entity: c.entity,
      confidence: c.confidence,
    }));
  best.patch?.(plan);

  // ---- scope and filters -------------------------------------------------------------------------------------------
  plan.scope = hasPatient
    ? 'PATIENT'
    : entities.includes('QUEUE')
      ? 'QUEUE'
      : specialty
        ? 'SPECIALTY'
        : roleHit && plan.entity === 'STAFF'
          ? 'ROLE'
          : 'HOSPITAL';
  if (specialty) plan.filters.specialty = specialty;
  if (roleHit && (plan.entity === 'STAFF' || plan.entity === 'SPECIALIST'))
    plan.filters.role = roleHit;
  if (/\bavailable|free|on duty|working\b/i.test(text))
    plan.filters.availability = true;
  if (
    plan.entity === 'QUEUE' &&
    plan.intent === 'LIST' &&
    LONGEST_WAIT.test(text)
  )
    plan.filters.rank = 'LONGEST_WAIT';
  if (/\btoday\b/i.test(text)) plan.filters.date = 'TODAY';
  else if (/\btomorrow\b/i.test(text)) plan.filters.date = 'TOMORROW';
  else if (/\bthis week\b/i.test(text)) plan.filters.date = 'THIS_WEEK';
  if (plan.intent === 'POLICY_QUERY') {
    plan.filters.docType = OWNERSHIP_SHAPE.test(text)
      ? 'policy'
      : /\b(criteria|indication|guideline)s?\b/i.test(text)
        ? 'guideline'
        : undefined;
    if (!plan.filters.docType) delete plan.filters.docType;
  }
  if (plan.intent === 'LOOKUP' && sectionEntities.length)
    plan.filters.sections = sectionEntities.map((e) => e.toLowerCase());
  if (plan.intent === 'COUNT' && plan.entity === 'OTHER')
    plan.noun = countedNounOf(text);

  // ---- confidence: a close rival reading makes the question ambiguous ---------------------------------------------
  // Readings that are only a more generic view of the same question (a plain patient lookup next to a review or a
  // specialist question) do not compete; two different SPECIFIC subjects do.
  const generic = (e: Entity) => e === 'PATIENT' || e === 'NONE';
  const rival = plan.alternatives.find(
    (a) =>
      a.entity !== best.entity &&
      !generic(a.entity) &&
      !generic(best.entity) &&
      !(best.intent === 'CLINICAL_REVIEW') &&
      !(best.intent === 'ACTION'),
  );
  if (rival && best.confidence - rival.confidence < 0.1) {
    plan.confidence = Math.min(plan.confidence, 0.6);
    plan.evidence.push(`close rival reading: ${rival.intent}/${rival.entity}`);
  }
  return plan;
}

function metricEntity(m: OverviewMetric): Entity {
  return (
    {
      appointments: 'APPOINTMENT',
      tasks: 'TASK',
      criticalLabs: 'LAB',
      completedToday: 'VISIT',
      withDoctor: 'VISIT',
      waiting: 'QUEUE',
      patients: 'PATIENT',
    } as Record<OverviewMetric, Entity>
  )[m];
}

/** What is being counted, as typed ("beds" in "how many beds are free"), or undefined when nothing is named. */
export function countedNounOf(text: string): string | undefined {
  const m = text.match(
    /(?:how many|number of|count of|total (?:number|count)(?: of)?)\s+(?:the\s+)?([a-z][a-z -]{1,30}?)(?:\s+(?:are|is|do|does|did|were|was|have|has|in|at|on|available|there|we)\b|[?.!,]|$)/i,
  );
  const noun = m?.[1]?.trim();
  return noun &&
    !/^(are|is|we|they|there|them|it|do|does|today|tomorrow|now|here|currently|total|available|more|left|altogether|in total)$/i.test(
      noun,
    )
    ? noun
    : undefined;
}
