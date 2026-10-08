import { ToolTrace } from './tools/tool-registry';

export interface GuardrailResult {
  status: 'VERIFIED_SAFE' | 'WARNING';
  notes: string[];
}

// Matches seeded ids (P1001) and generated ids (P + 6 unambiguous chars).
const PATIENT_ID = /\bP(?:\d{4}|[A-HJ-NP-Z2-9]{6})\b/g;

/** Post-generation checks: failed tools, unretrieved IDs, and unverified completion claims. */
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
