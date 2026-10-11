import { ToolTrace } from './tools/tool-registry';
import { meaningfulTerms } from './rag/query-terms';

export interface GuardrailResult {
  status: 'VERIFIED_SAFE' | 'WARNING';
  notes: string[];
}

// Matches seeded ids (P1001) and generated ids (P + 6 unambiguous chars).
const PATIENT_ID = /\bP(?:\d{4}|[A-HJ-NP-Z2-9]{6})\b/g;

/**
 * ============================================================================
 * 🛡️ CONCEPT: Guardrails (Safety, Factuality & Non-Fabrication)
 * ============================================================================
 * WHAT IT IS:
 * Post-generation and pre-presentation safety barriers that inspect LLM output
 * to detect hallucinations, prevent false claims, enforce citation integrity,
 * and intercept unauthorized actions before showing responses to clinicians.
 *
 * HOW IMPLEMENTED:
 * - Patient ID Hallucination Check (`checkGuardrails`):
 *   Extracts patient IDs in generated text; if the ID was never retrieved by
 *   any tool call nor typed by the user, flags an immediate warning.
 * - False Completion Claim Interception (`reconcileActionClaims`):
 *   Checks for claims like "I have registered / booked / deleted". If no action
 *   was executed this turn, replaces the hallucinated claim with the actual
 *   truth (e.g. "I prepared a proposal waiting for your approval").
 * - Citation & Omission Fallbacks:
 *   - `appendClosestPassage`: Recovers policy text when LLM falsely claims "not found".
 *   - `appendOmittedPatients`: Injects patients omitted by small model context windows.
 *   - `looksLikeRawToolCall`: Catches raw JSON tool call leaks.
 *
 * USE CASE:
 * Protects patients from medical errors caused by AI hallucinations, ensuring
 * that phantom patient records or false order completions never reach clinical staff.
 * ============================================================================
 * Post-generation checks: failed tools, unretrieved IDs, and unverified completion claims.
 */
export function checkGuardrails(
  response: string,
  trace: ToolTrace,
  userMessage: string,
  executedActionsCount = 0,
): GuardrailResult {
  const notes: string[] = [];

  for (const c of trace.calls.filter((c) => !c.success))
    notes.push(
      `Tool "${c.name}" failed; related statements may be incomplete.`,
    );

  for (const id of new Set(response.match(PATIENT_ID) ?? [])) {
    if (!trace.saw(id) && !userMessage.includes(id))
      notes.push(
        `Patient ID ${id} in the answer was not retrieved from any record.`,
      );
  }

  // W6 Guardrail: False Completion Claim check
  const claimRegex =
    /\b(has been (registered|booked|created|assigned|saved|completed|closed|reopened)|action (done|completed))\b/i;
  if (claimRegex.test(response) && executedActionsCount === 0) {
    notes.push(
      'Completion claim detected in answer text, but no approved action was executed this turn.',
    );
  }

  return { status: notes.length ? 'WARNING' : 'VERIFIED_SAFE', notes };
}

/** Tools that change data immediately when called (the others only read, or only create a proposal). */
/** No agent tool writes directly any more (everything goes through proposals); kept so a future direct tool must be listed here. */
export const DIRECT_WRITE_TOOLS: ReadonlySet<string> = new Set<string>([]);

/** Past-tense or "done" wording: the answer says something has already happened. */
/** First-person or plain "it is done" claims about a change (always checked). */
const DONE_CLAIM_PLAIN =
  /\b(?:i|we)(?:'ve| have)?\s+(?:just\s+|already\s+|successfully\s+)?(?:done|taken care of|sorted|handled|processed|placed|made|deleted|removed|changed|updated|cancelled|canceled|approved|granted|modified|rescheduled|transferred|discharged|admitted)\s+(?:it|that|this|them|the\s+\w+(?:\s+\w+)?|your\s+\w+(?:\s+\w+)?)\b|\b(?:it(?:'s| is| has been)|that(?:'s| is| has been)|all|everything is)\s+(?:been\s+)?done\b|\b(?:i|we)(?:'ve| have)?\s+(?:deleted|removed|changed|updated|cancelled|canceled|approved|granted|modified|rescheduled|transferred|discharged|admitted)\b/i;
/**
 * Passive "was changed / has been deleted" claims. They also occur in ordinary read-only answers ("the record was updated
 * on 5 Oct"), so they count only when the user actually asked for a change.
 */
const DONE_CLAIM_PASSIVE =
  /\b(?:has|have|was|were)\s+(?:been\s+|successfully\s+)*(?:deleted|removed|changed|updated|cancelled|canceled|approved|granted|modified|rescheduled|transferred)\b/i;
const DONE_CLAIM =
  /\b(i|we)(?:'ve| have)?\s+(?:just\s+|already\s+|successfully\s+)?(referred|booked|scheduled|created|registered|recorded|ordered|sent|notified|assigned|saved|submitted|completed|closed|reopened|escalated|forwarded)\b|\b(has|have|was|were) (?:been |successfully )+(referred|booked|scheduled|created|registered|recorded|ordered|sent|notified|assigned|saved|submitted|completed|closed|reopened)\b|\b(referral|appointment|order|notification|task) (?:is |was |has been )?(?:created|sent|booked|placed|done)\b/i;

/** Wording that says a proposal exists / is waiting for approval. */
const PROPOSAL_CLAIM =
  /\b(?:prepared|proposed|drafted|queued|submitted|saved|created)\b[^.\n]{0,60}\b(?:for (?:your )?approval|proposal)\b|\b(?:waiting|awaiting|pending)\s+(?:for\s+)?(?:your\s+)?approval\b|\bfor your approval\b|\bapproval card\b/i;

export interface ProposalView {
  id: string;
  type: string;
  tier: string;
  summary: string;
  status: string;
  patientId?: string;
  expiresAt?: string;
}

/** Proposals the agent saved this turn (they exist, but nothing has been executed until a human approves). */
export function proposalsFromTrace(trace: ToolTrace): ProposalView[] {
  const seen = new Set<string>();
  return trace.outputs
    .filter((o) => o.output?.success && typeof o.output?.actionId === 'string')
    .filter(
      (o) => !seen.has(o.output.actionId) && !!seen.add(o.output.actionId),
    )
    .map((o) => ({
      id: o.output.actionId,
      type: o.output.proposalType,
      tier: o.output.tier,
      summary: o.output.summary,
      // an identical earlier request may already be decided: show what it really is, never a false "waiting"
      status:
        o.output.status === 'PENDING_APPROVAL' || !o.output.status
          ? 'PENDING'
          : String(o.output.status),
      patientId: o.output.proposedAction?.patientId ?? undefined,
      expiresAt: o.output.expiresAt
        ? new Date(o.output.expiresAt).toISOString()
        : undefined,
    }));
}

/**
 * "Done" may only be said when something was really done. If the answer claims completion but no write tool succeeded
 * this turn, the model's text is replaced by what actually happened: proposals waiting for approval, or nothing.
 */
export function reconcileActionClaims(
  response: string,
  trace: ToolTrace,
  opts: { actionRequested?: boolean } = {},
): { text: string; notes: string[] } {
  const proposals = proposalsFromTrace(trace);
  const wrote = trace.calls.some(
    (c) => c.success && DIRECT_WRITE_TOOLS.has(c.name),
  );
  const claims =
    DONE_CLAIM.test(response) ||
    DONE_CLAIM_PLAIN.test(response) ||
    (opts.actionRequested === true && DONE_CLAIM_PASSIVE.test(response));
  const failedActionTool = trace.calls.find(
    (c) =>
      !c.success &&
      (DIRECT_WRITE_TOOLS.has(c.name) || c.name.startsWith('propose')),
  );

  if (claims && !wrote) {
    const lines = proposals.length
      ? [
          `I have prepared ${proposals.length === 1 ? 'a proposal' : `${proposals.length} proposals`}, but nothing has been done yet. ${proposals.length === 1 ? 'It needs' : 'They need'} your approval:`,
          ...proposals.map((p) => `• ${p.summary} (${p.id})`),
          'Use Approve on the card below to carry it out, or Decline.',
        ]
      : [
          'No action was taken: nothing was created, booked, sent or changed.',
          failedActionTool
            ? `The attempt failed: ${failedActionTool.error ?? 'the system refused it'}.`
            : 'The assistant did not run any action.',
          'Name the patient and tell me what to do, and I will prepare a proposal for your approval.',
        ];
    return {
      text: lines.join('\n'),
      notes: [
        'The answer claimed an action was completed, but none was executed; the text was replaced with what actually happened.',
      ],
    };
  }
  // "I prepared it for your approval" with no proposal saved (the tool refused, or was never called) is just as false
  // as "done": the user would wait for a card that will never come.
  if (!proposals.length && !claims && PROPOSAL_CLAIM.test(response))
    return {
      text: [
        'No proposal was created, so there is nothing waiting for your approval and nothing was changed.',
        failedActionTool
          ? `The attempt was refused: ${failedActionTool.error ?? 'the system refused it'}.`
          : 'The assistant did not run any action.',
        'Tell me what is missing or different and I will try again.',
      ].join('\n'),
      notes: [
        'The answer said a proposal was waiting for approval, but none was saved; the text was replaced.',
      ],
    };
  if (proposals.length && !claims)
    return {
      text: `${response}\n\n${proposals.length === 1 ? 'Proposal' : 'Proposals'} waiting for your approval (nothing is done until you approve):\n${proposals.map((p) => `• ${p.summary} (${p.id})`).join('\n')}`,
      notes: [],
    };
  return { text: response, notes: [] };
}

const NOT_IN_DATA =
  /not in the data i retrieved|not (?:found|available|mentioned) in (?:the )?(?:retrieved )?(?:data|context|documents?)/i;

/**
 * A small model sometimes says "not in the data I retrieved" even though the retrieved passages DO contain the answer
 * (it failed to draw the inference). The user must never be left empty-handed in that case: show the best matching
 * passage verbatim so they can read it, and say that the assistant could not state it.
 * Only passages that share at least two meaningful words with the question (or are very close in meaning) are shown.
 */
export function appendClosestPassage(
  response: string,
  trace: ToolTrace,
  question: string,
): string {
  if (!NOT_IN_DATA.test(response)) return response;
  const terms = meaningfulTerms(question);
  let best: {
    file: string;
    heading: string;
    text: string;
    overlap: number;
  } | null = null;
  for (const o of trace.outputs) {
    if (o.name !== 'searchHospitalPolicies') continue;
    for (const m of o.output?.matches ?? []) {
      const hay = `${m.heading} ${m.text}`.toLowerCase();
      const overlap = terms.filter((t) =>
        hay.includes(t.slice(0, Math.max(4, t.length - 2))),
      ).length;
      const close = (m.similarity ?? 0) >= 0.66;
      if ((overlap >= 2 || close) && (!best || overlap > best.overlap))
        best = { file: m.file, heading: m.heading, text: m.text, overlap };
    }
  }
  if (!best) return response;
  const quote = best.text.replace(/\s+/g, ' ').slice(0, 450);
  return `${response}\n\nClosest passage found (${best.file} # ${best.heading}):\n"${quote}"\nI could not state the answer from it with confidence; please read the passage.`;
}

/** llama-family models sometimes print the tool call as the answer: {"name":"searchPatients","parameters":{...}} */
export function looksLikeRawToolCall(text: string): boolean {
  const t = text.trim();
  return (
    /^\s*(?:`{3}(?:json)?\s*)?\{\s*"name"\s*:\s*"[A-Za-z]+"\s*,\s*"(parameters|arguments)"\s*:/.test(
      t,
    ) ||
    /^<\|?python_tag\|?>/.test(t) ||
    /^\[\s*\{\s*"name"/.test(t)
  );
}

interface ListedPatient {
  id: string;
  name: string;
  age?: number;
  gender?: string;
  status?: string;
  statusLabel?: string;
  chiefComplaint?: string | null;
  waitMinutes?: number | null;
}

/**
 * Small models drop items from long lists. When the agent listed patients via searchPatients, any patient the answer
 * does not mention (by id or name) is appended from the system's own data, so a list answer is always complete.
 */
export function appendOmittedPatients(
  response: string,
  trace: ToolTrace,
): { text: string; omitted: number } {
  const returned = new Map<string, ListedPatient>();
  for (const o of trace.outputs) {
    if (o.name === 'searchPatients')
      for (const p of (o.output?.patients ?? []) as ListedPatient[])
        returned.set(p.id, p);
  }
  if (!returned.size) return { text: response, omitted: 0 };
  const lower = response.toLowerCase();
  const missing = [...returned.values()].filter(
    (p) =>
      !lower.includes(p.id.toLowerCase()) &&
      !lower.includes(String(p.name).toLowerCase()),
  );
  if (!missing.length) return { text: response, omitted: 0 };
  const lines = missing.map(
    (p) =>
      `- ${p.name} (id: ${p.id})${p.age ? `, age ${p.age}` : ''}${p.gender ? `, ${p.gender}` : ''}${p.chiefComplaint ? `, ${p.chiefComplaint}` : ''}${p.status ? `, status: ${p.status}` : ''}`,
  );
  // The model listed none of them: its prose is unreliable, so show the system's own list instead.
  if (missing.length === returned.size) {
    return {
      text: `Patients in the system (${returned.size}):\n${lines.join('\n')}`,
      omitted: missing.length,
    };
  }
  return {
    text: `${response.trimEnd()}\n\nAlso returned by the system (not listed above):\n${lines.join('\n')}`,
    omitted: missing.length,
  };
}

/**
 * Clean, deterministic rendering of a patient list straight from the system data (no model formatting involved).
 * Plain text so it reads well in any chat surface.
 */
export function renderPatientList(
  trace: ToolTrace,
  title?: string,
): string | null {
  const calls = trace.outputs.filter((o) => o.name === 'searchPatients');
  const last = calls[calls.length - 1];
  if (!last) return null;
  const patients = (last.output?.patients ?? []) as ListedPatient[];
  const total = last.output?.total ?? patients.length;
  if (!patients.length) return 'No patients match.';
  const lines = patients.map((p, i) => {
    const bits = [
      `${p.age ?? '?'} y`,
      p.gender ?? '',
      p.statusLabel ?? p.status ?? '',
    ]
      .filter(Boolean)
      .join(', ');
    return `${i + 1}. ${p.name} (${p.id}) — ${bits}${p.chiefComplaint ? ` — ${p.chiefComplaint}` : ''}`;
  });
  const more =
    total > patients.length
      ? `\n…and ${total - patients.length} more (ask to narrow the list).`
      : '';
  return `${title ?? 'Patients in the system'} (${total}):\n${lines.join('\n')}${more}`;
}

/** The waiting list ranked by wait time, longest first (answers "who has waited longest" from the data, never a guess). */
export function renderLongestWaiting(trace: ToolTrace): string | null {
  const calls = trace.outputs.filter((o) => o.name === 'searchPatients');
  const last = calls[calls.length - 1];
  if (!last) return null; // the list was never fetched (e.g. the role may not list patients): say nothing rather than "nobody"
  const waiting = ((last?.output?.patients ?? []) as ListedPatient[]).filter(
    (p) => typeof p.waitMinutes === 'number',
  );
  if (!waiting.length) return 'Nobody is waiting right now.';
  const ranked = [...waiting].sort(
    (a, b) => (b.waitMinutes ?? 0) - (a.waitMinutes ?? 0),
  );
  const fmt = (m: number) =>
    m >= 1440
      ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`
      : m >= 60
        ? `${Math.floor(m / 60)} h ${m % 60} min`
        : `${m} min`;
  const line = (p: ListedPatient, i: number) =>
    `${i + 1}. ${p.name} (${p.id}) — waiting ${fmt(p.waitMinutes ?? 0)} (${p.waitMinutes} min) — ${p.statusLabel ?? p.status ?? ''}${p.chiefComplaint ? ` — ${p.chiefComplaint}` : ''}`;
  return `Waiting longest: ${ranked[0].name} (${ranked[0].id}), ${fmt(ranked[0].waitMinutes ?? 0)}.\nAll waiting, longest first (${ranked.length}):\n${ranked.map(line).join('\n')}`;
}
