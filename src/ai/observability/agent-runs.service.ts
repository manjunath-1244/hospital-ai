import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThan, Repository } from 'typeorm';
import { AgentRunEntity } from '../../database/entities/agent-run.entity';
import { AgentActionEntity } from '../../database/entities/agent-action.entity';
import { computeMetrics, detectDrift, RunRow } from './metrics';

const ROW_SELECT = {
  status: true,
  durationMs: true,
  guardrailStatus: true,
  toolCallCount: true,
  toolFailureCount: true,
  toolNames: true,
  model: true,
  usage: true,
} as const;

@Injectable()
export class AgentRunsService {
  private readonly logger = new Logger(AgentRunsService.name);

  constructor(
    @InjectRepository(AgentRunEntity)
    private readonly repo: Repository<AgentRunEntity>,
    @Optional()
    @InjectRepository(AgentActionEntity)
    private readonly actionRepo?: Repository<AgentActionEntity>,
  ) {}

  /** Persists the trace and emits one structured log line (greppable by traceId). Never throws into the request path. */
  async save(run: Omit<AgentRunEntity, 'at'>) {
    this.logger.log(
      JSON.stringify({
        event: 'agent.run',
        traceId: run.id,
        kind: run.kind,
        role: run.userRole,
        model: run.model,
        status: run.status,
        durationMs: run.durationMs,
        tools: run.toolNames,
        toolFailures: run.toolFailureCount,
        retries: run.retries,
        guardrail: run.guardrailStatus,
        error: run.error,
        goal: run.goal,
      }),
    );
    try {
      await this.repo.save(this.repo.create(run));
    } catch (err: any) {
      this.logger.error(
        `Failed to persist agent run ${run.id}: ${err.message}`,
      );
    }
  }

  async list(limit = 50) {
    const rows = await this.repo.find({
      order: { at: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      goal: r.goal ?? null,
      userRole: r.userRole,
      model: r.model,
      status: r.status,
      durationMs: r.durationMs,
      guardrailStatus: r.guardrailStatus,
      toolCalls: r.toolCallCount,
      retries: r.retries,
      decisionsCount: (r.decisions ?? []).length,
      actionIdsCount: (r.actionIds ?? []).length,
      error: r.error,
    }));
  }

  /** Detailed Admin "Agent Run" view: Goal -> Context -> Tool calls -> Results -> Decisions -> Actions -> Final result */
  async get(id: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`Run ${id} not found`);

    let actions: AgentActionEntity[] = [];
    if (this.actionRepo) {
      try {
        actions = await this.actionRepo.find({ where: { traceId: id } });
      } catch {
        actions = [];
      }
    }

    return {
      ...r,
      goal: r.goal ?? null,
      contextSnapshot: r.context ?? null,
      decisions: r.decisions ?? [],
      actionIds: r.actionIds ?? [],
      actions: actions.map((a) => ({
        id: a.id,
        type: a.type,
        tier: a.tier,
        status: a.status,
        summary: a.summary,
        payload: a.payload,
        createdAt: a.createdAt,
        decidedAt: a.decidedAt,
      })),
      flow: {
        goal: r.goal ?? null,
        context: r.context ?? null,
        steps: r.steps ?? [],
        toolCallsCount: r.toolCallCount,
        decisions: r.decisions ?? [],
        actions: actions.map((a) => ({
          id: a.id,
          type: a.type,
          status: a.status,
          summary: a.summary,
        })),
        result: r.status === 'OK' ? 'SUCCESS' : (r.error ?? 'FAILED'),
      },
    };
  }

  async metrics(hours = 24) {
    const now = Date.now();
    const since = new Date(now - hours * 3_600_000);
    const baselineHours = 168;
    const baselineFrom = new Date(since.getTime() - baselineHours * 3_600_000);
    const current = (await this.repo.find({
      where: { at: MoreThan(since) },
      select: ROW_SELECT,
      take: 5000,
    })) as RunRow[];
    const base = (await this.repo.find({
      where: { at: Between(baselineFrom, since) },
      select: ROW_SELECT,
      take: 20000,
    })) as RunRow[];
    const window = computeMetrics(current, hours);
    const baseline = computeMetrics(base, baselineHours);
    const proposals = await this.proposalMetrics(hours);
    const routing = await this.routeMetrics(hours);
    return {
      window,
      baseline,
      drift: detectDrift(window, baseline),
      proposals,
      routing,
    };
  }

  /**
   * How questions were understood and routed in the window: which handlers answered, how often the model planner (L2)
   * was needed, how often we asked back, and how confident the parser was. A rising L2/agent share or falling confidence
   * is routing drift.
   */
  async routeMetrics(hours = 24) {
    const since = new Date(Date.now() - hours * 3_600_000);
    const rows = await this.repo.find({
      where: { at: MoreThan(since) },
      select: { id: true, route: true },
      take: 5000,
    });
    const routed = rows.filter((r) => r.route);
    const n = routed.length;
    const count = (
      f: (r: NonNullable<(typeof routed)[number]['route']>) => boolean,
    ) => routed.filter((r) => f(r.route!)).length;
    const byHandler: Record<string, number> = {};
    for (const r of routed)
      byHandler[r.route!.handler] = (byHandler[r.route!.handler] ?? 0) + 1;
    const rate = (x: number) => (n ? Number((x / n).toFixed(3)) : 0);
    return {
      hours,
      routedQuestions: n,
      byHandler,
      avgConfidence: n
        ? Number(
            (routed.reduce((a, r) => a + r.route!.confidence, 0) / n).toFixed(
              3,
            ),
          )
        : 0,
      l2Rate: rate(count((r) => r.usedL2)),
      clarifyRate: rate(count((r) => r.decision === 'CLARIFY')),
      agentFallbackRate: rate(
        count((r) => r.decision === 'AGENT' || r.handler === 'agent.model'),
      ),
      lowConfidenceRate: rate(count((r) => r.confidence < 0.75)),
    };
  }

  /** Analytics for action proposals: acceptance, decline, expiry rates, and time-to-decision */
  async proposalMetrics(hours = 24) {
    if (!this.actionRepo) {
      return {
        hours,
        totalProposals: 0,
        approved: 0,
        declined: 0,
        expired: 0,
        pending: 0,
        acceptanceRate: 0,
        declineRate: 0,
        expiryRate: 0,
        avgTimeToDecisionMs: 0,
        byType: {},
      };
    }
    const since = new Date(Date.now() - hours * 3_600_000);
    let actions: AgentActionEntity[] = [];
    try {
      actions = await this.actionRepo.find({
        where: { createdAt: MoreThan(since) },
      });
    } catch {
      actions = [];
    }
    const total = actions.length;
    const approved = actions.filter(
      (a) => a.status === 'APPROVED' || a.status === 'DONE',
    ).length;
    const declined = actions.filter((a) => a.status === 'DECLINED').length;
    const expired = actions.filter((a) => a.status === 'EXPIRED').length;
    const pending = actions.filter((a) => a.status === 'PENDING').length;
    const resolved = approved + declined;

    const times = actions
      .filter((a) => a.decidedAt && a.createdAt)
      .map((a) => a.decidedAt!.getTime() - a.createdAt.getTime());

    const avgTimeMs = times.length
      ? Math.round(times.reduce((s, t) => s + t, 0) / times.length)
      : 0;

    const byType: Record<string, number> = {};
    for (const a of actions) {
      byType[a.type] = (byType[a.type] || 0) + 1;
    }

    return {
      hours,
      totalProposals: total,
      approved,
      declined,
      expired,
      pending,
      acceptanceRate: resolved ? Number((approved / resolved).toFixed(3)) : 0,
      declineRate: resolved ? Number((declined / resolved).toFixed(3)) : 0,
      expiryRate: total ? Number((expired / total).toFixed(3)) : 0,
      avgTimeToDecisionMs: avgTimeMs,
      byType,
    };
  }
}
