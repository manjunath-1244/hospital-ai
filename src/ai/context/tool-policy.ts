import type { UserRole } from '../../security/roles.decorator';
import type { AgentContext } from './agent-context';

/**
 * ============================================================================
 * 🔒 CONCEPT: Dynamic Context Fencing & Cross-Patient Leakage Prevention
 * ============================================================================
 * WHAT IT IS:
 * Runtime policy enforcement engine that prevents AI agents from executing tools
 * on closed visits or targeting patients outside the active conversational boundary.
 *
 * HOW IMPLEMENTED:
 * - Dynamic Visit State Guards (`withheldReason`):
 *   Automatically withholds tools (e.g. consultations, appointments, tasks) if the
 *   patient's encounter has already been discharged or closed.
 * - Cross-Patient Access Barriers (`bindingViolation`):
 *   Inspects tool call arguments; if a tool attempts to act on a `patientId` not
 *   explicitly authorized in `ctx.allowedPatientIds`, actively blocks the call:
 *   "Refused: [ID] is not the patient this conversation is about."
 *
 * USE CASE:
 * Prevents dangerous medical mix-ups and cross-patient contamination where an AI model
 * might inadvertently modify Patient B's medical chart while conversing about Patient A.
 * ============================================================================
 * What a tool declares about itself; the policy below is the only code that interprets it.
 */
export interface ToolRequirements {
  /** Needs the patient's visit to be open (no consultations, bookings or tasks on a finished visit). */
  openVisit?: boolean;
  /** Acts on the patient in its `patientId` argument, which must be one of the context's allowed patients. */
  patientBound?: boolean;
}
export interface PolicyTool {
  name: string;
  roles: UserRole[];
  requires?: ToolRequirements;
}

/** Why a tool is withheld in this state, or null when it is available. Role gating is handled separately. */
export function withheldReason(
  tool: PolicyTool,
  ctx: Pick<AgentContext, 'visit'>,
): string | null {
  if (tool.requires?.openVisit && ctx.visit && !ctx.visit.isOpen)
    return `the patient's visit is ${ctx.visit.status.toLowerCase().replace(/_/g, ' ')}; reopen it first`;
  return null;
}

/** Fills `permissions` for a context from the tool catalogue (the role filter is applied here too). */
export function applyToolPolicy(
  ctx: Omit<AgentContext, 'permissions'>,
  tools: PolicyTool[],
): AgentContext {
  const mine = tools.filter((t) => t.roles.includes(ctx.user.role));
  const withheld: Array<{ tool: string; reason: string }> = [];
  const visible: string[] = [];
  for (const t of mine) {
    const reason = withheldReason(t, ctx);
    if (reason) withheld.push({ tool: t.name, reason });
    else visible.push(t.name);
  }
  return { ...ctx, permissions: { tools: visible, withheld } };
}

/** Error message when a patient-bound tool is aimed at a patient outside the context, otherwise null. */
export function bindingViolation(
  tool: PolicyTool,
  args: unknown,
  ctx: Pick<AgentContext, 'allowedPatientIds'>,
): string | null {
  if (!tool.requires?.patientBound) return null;
  const raw = (args as { patientId?: unknown } | null)?.patientId;
  if (typeof raw !== 'string' || !raw.trim()) return null; // tool acts on no patient (e.g. a general task)
  const id = raw.trim().toUpperCase();
  if (ctx.allowedPatientIds.includes(id)) return null;
  return `Refused: ${id} is not the patient this conversation is about. Ask the user to name the patient (or confirm ${id}) in their message first.`;
}
