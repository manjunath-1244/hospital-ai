import { randomUUID } from 'crypto';
import { ToolTrace } from '../tools/tool-registry';
import type { AuthUser } from '../../security/auth-user';
import type { PhiSession } from '../security/phi-session';
import type {
  AgentRunEntity,
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

/** Collects the spans of one agent run (memory, LLM, tools) and turns them into a persistable trace. */
export class RunRecorder {
  readonly traceId = randomUUID();
  readonly trace = new ToolTrace();
  readonly t0 = Date.now();
  retries = 0;
  private readonly spans: RunStep[] = [];

  constructor(
    readonly kind: 'chat' | 'document',
    readonly user: AuthUser,
    readonly model: string,
  ) {}

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
    };
  }
}
