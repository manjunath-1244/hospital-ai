import { createHash } from 'crypto';
import type { UserRole } from '../../security/roles.decorator';

/**
 * Everything the agent is allowed to act on for ONE request, built by the server before the model runs.
 * Tools read from this, not from ids the model (or text inside a record) happens to produce, and the PHI-free
 * snapshot of it is stored on the run so a trace shows exactly what the agent knew and could do.
 * Contains ids and statuses only: no names, so it is safe to persist.
 */
export interface AgentContext {
  user: {
    id: string;
    role: UserRole;
    specialty: string | null;
  };
  /** The patient this request is about (null for hospital-wide or policy questions). */
  patient: { id: string } | null;
  /**
   * Patients a write tool may act on: those named in this message plus the conversation's current patient.
   * An id that only appeared inside a tool result or a document is NOT in this list.
   */
  allowedPatientIds: string[];
  /** The patient's open visit, or their latest finished one. Current-visit facts outrank history. */
  visit: {
    id: string;
    status: string;
    isOpen: boolean;
    priority: number | null;
  } | null;
  conversation: {
    threadId: string | null;
    summarized: boolean;
  };
  permissions: {
    /** Tools the model can see in this state. */
    tools: string[];
    /** Tools withheld in this state, and why (role tools the role never had are not listed). */
    withheld: Array<{ tool: string; reason: string }>;
  };
  now: string;
}

/** Stable fingerprint of the context (ignores the clock) so two runs can be compared and a trace can reference it. */
export function contextHash(ctx: AgentContext): string {
  const { now: _now, ...rest } = ctx;
  return createHash('sha256')
    .update(JSON.stringify(rest))
    .digest('hex')
    .slice(0, 16);
}
