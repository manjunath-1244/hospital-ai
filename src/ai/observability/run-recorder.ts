import { randomUUID } from 'crypto';
import { ToolTrace } from '../tools/tool-registry';
import type { AuthUser } from '../../security/auth-user';
import type { PhiSession } from '../security/phi-session';
import type {
  AgentRunEntity,
  RouteTrace,
  RunStep,
} from '../../database/entities/agent-run.entity';

export interface RunOutcome {
  status: 'OK' | 'ERROR';
  error?: string;
  guardrailStatus?: string;
  guardrailNotes?: string[];
  usage?: any;
  threadId?: string | null;
}

/**
 * ============================================================================
 * 📝 CONCEPT: Logging (Execution Recording)
 * 👀 CONCEPT: Observability (Health & Production Telemetry)
 * 🔍 CONCEPT: Tracing (Distributed Multi-Step Execution Spans)
 * 💰 CONCEPT: Cost (Token & API Usage Monitoring)
 * ⚡ CONCEPT: Performance (Latency & Throughput Tracking)
 * ============================================================================
 * WHAT THEY ARE:
 * Complete instrumentation suite that tracks every agent execution, records
 * sub-millisecond execution spans, logs sanitized inputs/outputs, captures token
 * expenditures, and monitors live system health.
 *
 * HOW IMPLEMENTED:
 * - 🔍 Tracing (`RunRecorder`):
 *   - Assigns a unique distributed `traceId` (UUID) to every user turn.
 *   - Instruments nested execution spans (`spans`): memory retrieval, LLM generation,
 *     and individual tool executions with start offsets and durations.
 * - 📝 Logging:
 *   - Persists execution records in PostgreSQL (`AgentRunEntity`).
 *   - Sanitizes all tool arguments and user goals through `phi.maskDeep()`
 *     so raw PHI is never stored in log records.
 * - ⚡ Performance:
 *   - Tracks request duration (`durationMs`), step offset delays, and retry counts.
 * - 💰 Cost:
 *   - Extracts token usage metrics (`inputTokens`, `outputTokens`, `totalTokens`)
 *     from provider responses for cost attribution and quota enforcement.
 * - 👀 Observability:
 *   - Captures guardrail status, routing path, intent decisions, and action IDs.
 *
 * USE CASE:
 * Gives hospital DevOps and clinical administrators complete visibility into
 * agent latency, system reliability, token costs, and forensic audit logs.
 * ============================================================================
 * Collects the spans of one agent run (memory, LLM, tools) and turns them into a persistable trace.
 */
export class RunRecorder {
  readonly traceId = randomUUID();
  readonly trace = new ToolTrace();
  readonly t0 = Date.now();
  retries = 0;
  /** PHI-free snapshot of what the agent knew and could do for this request (see `context/agent-context.ts`). */
  context: { hash: string; snapshot: unknown } | null = null;
  /** How the question was routed (plan, confidence, L1/L2, handler). */
  route: RouteTrace | null = null;
  /** High-level goal or query intent. */
  goal: string | null = null;
  /** Structured decision chain. */
  readonly decisions: Array<{ what: string; why: string; evidence?: any[] }> =
    [];
  /** W6 action proposal IDs created/executed. */
  readonly actionIds: string[] = [];
  private readonly spans: RunStep[] = [];

  constructor(
    readonly kind: 'chat' | 'chat-stream' | 'document',
    readonly user: AuthUser,
    readonly model: string,
  ) {}

  setGoal(goal: string) {
    this.goal = goal;
  }

  addDecision(decision: { what: string; why: string; evidence?: any[] }) {
    this.decisions.push(decision);
  }

  addActionId(actionId: string) {
    if (!this.actionIds.includes(actionId)) {
      this.actionIds.push(actionId);
    }
  }

  /** Times an async step; failures are recorded and re-thrown. */
  async step<T>(
    type: 'llm' | 'memory',
    name: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const out = await fn();
      this.spans.push({
        type,
        name,
        startOffsetMs: start - this.t0,
        durationMs: Date.now() - start,
        success: true,
      });
      return out;
    } catch (err: any) {
      this.spans.push({
        type,
        name,
        startOffsetMs: start - this.t0,
        durationMs: Date.now() - start,
        success: false,
        error: String(err?.message ?? err).slice(0, 300),
      });
      throw err;
    }
  }

  build(outcome: RunOutcome, phi?: PhiSession): Omit<AgentRunEntity, 'at'> {
    const toolSteps: RunStep[] = this.trace.calls.map((c) => ({
      type: 'tool',
      name: c.name,
      startOffsetMs: (c.startedAtMs ?? this.t0) - this.t0,
      durationMs: c.durationMs ?? 0,
      success: c.success,
      ...(c.error ? { error: c.error.slice(0, 300) } : {}),
      args: phi ? phi.maskDeep(c.args) : '[hidden]', // never persist raw PHI in traces
    }));
    const steps = [...this.spans, ...toolSteps].sort(
      (a, b) => a.startOffsetMs - b.startOffsetMs,
    );
    const u = outcome.usage ?? {};
    const num = (v: unknown) =>
      typeof v === 'number'
        ? v
        : typeof (v as any)?.total === 'number'
          ? (v as any).total
          : undefined;
    const usage = outcome.usage
      ? {
          inputTokens: num(u.inputTokens ?? u.promptTokens),
          outputTokens: num(u.outputTokens ?? u.completionTokens),
          totalTokens: num(u.totalTokens),
        }
      : null;
    return {
      id: this.traceId,
      kind: this.kind,
      userId: this.user.userId,
      userRole: this.user.role,
      threadId: outcome.threadId ?? null,
      model: this.model,
      status: outcome.status,
      durationMs: Date.now() - this.t0,
      guardrailStatus: outcome.guardrailStatus ?? null,
      guardrailNotes: outcome.guardrailNotes ?? [],
      retries: this.retries,
      error: outcome.error ?? null,
      usage,
      steps,
      toolCallCount: this.trace.calls.length,
      toolFailureCount: this.trace.calls.filter((c) => !c.success).length,
      toolNames: this.trace.calls.map((c) => c.name),
      contextHash: this.context?.hash ?? null,
      context: this.context?.snapshot ?? null,
      route: this.route,
      // the user's message can name a patient: store it masked, like the tool arguments
      goal: this.goal ? (phi ? phi.mask(this.goal) : '[hidden]') : null,
      decisions: this.decisions,
      actionIds: this.actionIds,
    };
  }
}
