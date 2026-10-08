export interface RunRow {
  status: 'OK' | 'ERROR';
  durationMs: number;
  guardrailStatus: string | null;
  toolCallCount: number;
  toolFailureCount: number;
  toolNames: string[];
  model: string;
  usage: { totalTokens?: number } | null;
}

export interface Metrics {
  hours: number;
  runs: number;
  errorRate: number;
  guardrailWarnRate: number;
  toolFailureRate: number;
  noToolRate: number;
  avgToolCalls: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgTokens: number;
  topTools: Array<{ name: string; count: number }>;
  models: string[];
}

export interface DriftFinding {
  metric: string;
  current: number;
  baseline: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
}

const pct = (sorted: number[], p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
    : 0;
const round = (n: number, d = 3) => Number(n.toFixed(d));

export function computeMetrics(rows: RunRow[], hours: number): Metrics {
  const n = rows.length;
  const rate = (pred: (r: RunRow) => boolean) =>
    n ? round(rows.filter(pred).length / n) : 0;
  const totalToolCalls = rows.reduce((s, r) => s + r.toolCallCount, 0);
  const lat = rows.map((r) => r.durationMs).sort((a, b) => a - b);
  const tokens = rows
    .map((r) => r.usage?.totalTokens)
    .filter((t): t is number => typeof t === 'number');
  const tools = new Map<string, number>();
  rows.forEach((r) =>
    r.toolNames.forEach((t) => tools.set(t, (tools.get(t) ?? 0) + 1)),
  );
  const models = new Map<string, number>();
  rows.forEach((r) => models.set(r.model, (models.get(r.model) ?? 0) + 1));
  return {
    hours,
    runs: n,
    errorRate: rate((r) => r.status === 'ERROR'),
    guardrailWarnRate: rate((r) => r.guardrailStatus === 'WARNING'),
    toolFailureRate: totalToolCalls
      ? round(rows.reduce((s, r) => s + r.toolFailureCount, 0) / totalToolCalls)
      : 0,
    noToolRate: rate((r) => r.status === 'OK' && r.toolCallCount === 0),
    avgToolCalls: n ? round(totalToolCalls / n, 2) : 0,
    p50LatencyMs: Math.round(pct(lat, 0.5)),
    p95LatencyMs: Math.round(pct(lat, 0.95)),
    avgTokens: tokens.length
      ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length)
      : 0,
    topTools: [...tools.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count })),
    models: [...models.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
  };
}

export const MIN_RUNS_FOR_DRIFT = 20;

/**
 * Compares the recent window against a longer baseline. Rates that rise, latency that balloons and a shift in tool
 * usage are the usual signatures of agent drift (model update, prompt change, data change, provider degradation).
 */
export function detectDrift(
  current: Metrics,
  baseline: Metrics,
): DriftFinding[] {
  if (current.runs < MIN_RUNS_FOR_DRIFT || baseline.runs < MIN_RUNS_FOR_DRIFT)
    return [];
  const out: DriftFinding[] = [];

  const rateRise = (metric: keyof Metrics, label: string) => {
    const cur = current[metric] as number;
    const base = baseline[metric] as number;
    const delta = cur - base;
    if (delta >= 0.1) {
      out.push({
        metric,
        current: cur,
        baseline: base,
        severity: delta >= 0.25 ? 'CRITICAL' : 'WARNING',
        message: `${label} rose from ${(base * 100).toFixed(1)}% to ${(cur * 100).toFixed(1)}%.`,
      });
    }
  };
  rateRise('errorRate', 'Error rate');
  rateRise('guardrailWarnRate', 'Guardrail-warning rate');
  rateRise('toolFailureRate', 'Tool failure rate');
  rateRise('noToolRate', 'Answers given without calling any tool');

  if (baseline.p95LatencyMs > 0) {
    const ratio = current.p95LatencyMs / baseline.p95LatencyMs;
    if (ratio >= 1.5) {
      out.push({
        metric: 'p95LatencyMs',
        current: current.p95LatencyMs,
        baseline: baseline.p95LatencyMs,
        severity: ratio >= 2.5 ? 'CRITICAL' : 'WARNING',
        message: `p95 latency is ${ratio.toFixed(1)}x the baseline (${baseline.p95LatencyMs}ms -> ${current.p95LatencyMs}ms).`,
      });
    }
  }
  if (baseline.avgToolCalls > 0) {
    const rel =
      Math.abs(current.avgToolCalls - baseline.avgToolCalls) /
      baseline.avgToolCalls;
    if (rel >= 0.4) {
      out.push({
        metric: 'avgToolCalls',
        current: current.avgToolCalls,
        baseline: baseline.avgToolCalls,
        severity: 'WARNING',
        message: `Average tool calls per run changed by ${(rel * 100).toFixed(0)}% (${baseline.avgToolCalls} -> ${current.avgToolCalls}): the agent's behaviour has shifted.`,
      });
    }
  }
  if (
    current.models[0] &&
    baseline.models[0] &&
    current.models[0] !== baseline.models[0]
  ) {
    out.push({
      metric: 'model',
      current: 0,
      baseline: 0,
      severity: 'INFO',
      message: `Primary model changed: ${baseline.models[0]} -> ${current.models[0]}. Re-run the eval suite.`,
    });
  }
  return out;
}
