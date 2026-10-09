'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { AgentDriftItem, AgentMetrics, AgentRunDetail, AgentRunSummary, DriftSeverity } from '../../lib/types';
import { ErrorBox, Loading, fmtTime } from '../ui/common';
import { Alert, Badge, Button, Card, EmptyState, SectionTitle, StatTile, TableFrame, type Tone } from '../ui/kit';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ms = (v: number) => `${Math.round(v)} ms`;

const sevTone: Record<DriftSeverity, Tone> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',
};

const breakerTone = {
  CLOSED: 'success',
  HALF_OPEN: 'warning',
  OPEN: 'danger',
} as const;

const Waterfall: React.FC<{ run: AgentRunDetail }> = ({ run }) => {
  const total = Math.max(
    run.durationMs,
    ...run.steps.map((s) => s.startOffsetMs + s.durationMs),
    1,
  );
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-muted p-4 text-sm" data-testid="agent-run-detail">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-3">
        <span className="break-all font-mono text-xs text-ink-2">{run.id}</span>
        <span>{fmtTime(run.at)}</span>
        <span>{run.userRole}</span>
        <span>{run.model}</span>
        <span>{ms(run.durationMs)}</span>
        {run.threadId && <span className="break-all font-mono text-xs">thread {run.threadId}</span>}
      </div>
      {run.usage && (
        <p className="font-mono text-xs text-ink-2">
          Tokens: in {run.usage.inputTokens} / out {run.usage.outputTokens} / total {run.usage.totalTokens}
        </p>
      )}
      {run.guardrailNotes.length > 0 && (
        <Alert tone="warning" title="Guardrail notes">
          {run.guardrailNotes.map((n, i) => (
            <p key={i}>- {n}</p>
          ))}
        </Alert>
      )}
      <ErrorBox message={run.error ?? ''} />
      {run.steps.length === 0 && <EmptyState title="No steps recorded." />}
      <div className="space-y-1.5">
        {run.steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2" title={s.args ? JSON.stringify(s.args) : s.error}>
            <span className="w-28 shrink-0 truncate font-mono text-xs text-ink-2 sm:w-40">
              <span className="text-ink-3">{s.type}</span> {s.name}
            </span>
            <div className="relative h-4 flex-1 rounded bg-line">
              <div
                className={`absolute top-0 h-4 rounded ${s.success ? 'bg-brand-600' : 'bg-danger-600'}`}
                style={{
                  left: `${(s.startOffsetMs / total) * 100}%`,
                  width: `${Math.max((s.durationMs / total) * 100, 0.5)}%`,
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-xs text-ink-3">{ms(s.durationMs)}</span>
            <span className="sr-only">{s.success ? 'succeeded' : 'failed'}</span>
          </div>
        ))}
      </div>
      {run.steps.some((s) => s.error) && (
        <div className="space-y-1 text-sm text-danger-700">
          {run.steps.filter((s) => s.error).map((s, i) => (
            <p key={i} className="break-words">{s.name}: {s.error}</p>
          ))}
        </div>
      )}
      {run.steps.some((s) => s.args) && (
        <details className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-2">Raw step arguments (JSON)</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-ink-2">
            {JSON.stringify(run.steps.filter((s) => s.args).map((s) => ({ step: s.name, args: s.args })), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

export const AgentObservability: React.FC = () => {
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [metricsError, setMetricsError] = useState('');
  const [runs, setRuns] = useState<AgentRunSummary[] | null>(null);
  const [runsError, setRunsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, r] = await Promise.allSettled([
      apiFetch<AgentMetrics>('/admin/agent/metrics?hours=24'),
      apiFetch<AgentRunSummary[]>('/admin/agent/runs?limit=50'),
    ]);
    if (m.status === 'fulfilled') {
      setMetrics(m.value);
      setMetricsError('');
    } else setMetricsError(errorMessage(m.reason));
    if (r.status === 'fulfilled') {
      setRuns(r.value);
      setRunsError('');
    } else setRunsError(errorMessage(r.reason));
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const selectRun = async (id: string) => {
    if (id === selectedId) {
      setSelectedId(null);
      setDetail(null);
      return;
    }
    setSelectedId(id);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    try {
      const d = await apiFetch<AgentRunDetail>(`/admin/agent/runs/${encodeURIComponent(id)}`);
      setDetail(d);
    } catch (err) {
      setDetailError(errorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const w = metrics?.window;
  const drift: AgentDriftItem[] = metrics?.drift ?? [];

  return (
    <Card>
      <SectionTitle
        icon={<Activity className="h-5 w-5" />}
        actions={
          <>
            {metrics && (
              <Badge tone={breakerTone[metrics.breaker.state]}>
                Breaker: {metrics.breaker.state}
                {metrics.breaker.consecutiveFailures > 0 && ` (${metrics.breaker.consecutiveFailures} failures)`}
              </Badge>
            )}
            <Button variant="secondary" onClick={load} loading={loading} icon={<RefreshCw className="h-4 w-4" />}>
              Refresh
            </Button>
          </>
        }
      >
        Agent observability
      </SectionTitle>

      <div className="space-y-6">
        {loading && !metrics && <Loading text="Loading agent metrics..." />}
        <ErrorBox message={metricsError} />

        {w && (
          <>
            <p className="text-sm text-ink-3">Last {w.hours}h window. Auto-refreshes every 30s.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <StatTile label="Runs" value={String(w.runs)} />
              <StatTile label="Error rate" value={pct(w.errorRate)} />
              <StatTile label="Guardrail warnings" value={pct(w.guardrailWarnRate)} />
              <StatTile label="Tool failures" value={pct(w.toolFailureRate)} />
              <StatTile label="p50 latency" value={ms(w.p50LatencyMs)} />
              <StatTile label="p95 latency" value={ms(w.p95LatencyMs)} />
              <StatTile label="Avg tool calls" value={w.avgToolCalls.toFixed(1)} />
              <StatTile label="Avg tokens" value={Math.round(w.avgTokens).toString()} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-2 rounded-lg border border-line bg-surface-muted p-4 lg:col-span-2">
                <h3 className="text-sm font-semibold text-ink">Drift</h3>
                {w.runs < 20 ? (
                  <p className="text-sm text-ink-3">Not enough data yet</p>
                ) : drift.length === 0 ? (
                  <Badge tone="success">No drift detected</Badge>
                ) : (
                  drift.map((d, i) => (
                    <Alert key={i} tone={sevTone[d.severity]} title={`[${d.severity}] ${d.metric}`}>
                      <p>{d.message}</p>
                      <p className="font-mono text-xs">current {d.current.toFixed(3)} / baseline {d.baseline.toFixed(3)}</p>
                    </Alert>
                  ))
                )}
              </div>
              <div className="space-y-2 rounded-lg border border-line bg-surface-muted p-4">
                <h3 className="text-sm font-semibold text-ink">Top tools</h3>
                {w.topTools.length === 0 && <p className="text-sm text-ink-3">No tool usage yet.</p>}
                {w.topTools.map((t) => (
                  <div key={t.name} className="flex justify-between gap-2 font-mono text-xs text-ink-2">
                    <span className="break-all">{t.name}</span>
                    <span className="font-semibold text-brand-700">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Recent runs (latest 50)</h3>
          {loading && !runs && <Loading text="Loading runs..." />}
          <ErrorBox message={runsError} />
          {runs && runs.length === 0 && <EmptyState title="No agent runs recorded." hint="Runs appear here after someone uses the AI assistant." />}
          {runs && runs.length > 0 && (
            <>
              <p className="text-xs text-ink-3">Select a row to see its steps.</p>
              <TableFrame>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Status</th>
                      <th scope="col">Role</th>
                      <th scope="col">Model</th>
                      <th scope="col">Duration</th>
                      <th scope="col">Guardrail</th>
                      <th scope="col">Tools</th>
                      <th scope="col">Retries</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {runs.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => selectRun(r.id)}
                        data-testid="agent-run-row"
                        aria-selected={r.id === selectedId}
                        className={`cursor-pointer hover:bg-surface-muted ${r.id === selectedId ? 'bg-brand-50' : ''}`}
                      >
                        <td className="whitespace-nowrap">{fmtTime(r.at)}</td>
                        <td><Badge tone={r.status === 'OK' ? 'success' : 'danger'}>{r.status}</Badge></td>
                        <td>{r.userRole}</td>
                        <td className="break-all">{r.model}</td>
                        <td className="whitespace-nowrap">{ms(r.durationMs)}</td>
                        <td>{r.guardrailStatus === 'WARNING' ? <Badge tone="warning">{r.guardrailStatus}</Badge> : r.guardrailStatus}</td>
                        <td>{r.toolCalls}</td>
                        <td>{r.retries}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            </>
          )}
          {selectedId && detailLoading && <Loading text="Loading run..." />}
          <ErrorBox message={detailError} />
          {detail && <Waterfall run={detail} />}
        </div>
      </div>
    </Card>
  );
};
