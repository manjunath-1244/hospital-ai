import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThan, Repository } from 'typeorm';
import { AgentRunEntity } from '../../database/entities/agent-run.entity';
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
      userRole: r.userRole,
      model: r.model,
      status: r.status,
      durationMs: r.durationMs,
      guardrailStatus: r.guardrailStatus,
      toolCalls: r.toolCallCount,
      retries: r.retries,
      error: r.error,
    }));
  }

  async get(id: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`Run ${id} not found`);
    return r;
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
    return { window, baseline, drift: detectDrift(window, baseline) };
  }
}
