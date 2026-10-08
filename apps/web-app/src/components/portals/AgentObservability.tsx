'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { AgentDriftItem, AgentMetrics, AgentRunDetail, AgentRunSummary, DriftSeverity } from '../../lib/types';
import { Empty, ErrorBox, Loading, fmtTime } from '../ui/common';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const ms = (v: number) => `${Math.round(v)} ms`;

const sevCls: Record<DriftSeverity, string> = {
  INFO: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  WARNING: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  CRITICAL: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

const breakerCls = {
  CLOSED: 'bg-emerald-500/20 text-emerald-400',
  HALF_OPEN: 'bg-amber-500/20 text-amber-400',
  OPEN: 'bg-rose-500/20 text-rose-400',
} as const;

const Card: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl bg-slate-950 p-3 border border-slate-700">
    <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-bold font-mono text-white">{value}</p>
  </div>
);

const Waterfall: React.FC<{ run: AgentRunDetail }> = ({ run }) => {
  const total = Math.max(
    run.durationMs,
    ...run.steps.map((s) => s.startOffsetMs + s.durationMs),
    1,
  );
  return (
    <div className="rounded-xl bg-slate-950 border border-slate-700 p-4 space-y-3 text-sm">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-400">
        <span className="font-mono text-slate-300">{run.id}</span>
        <span>{fmtTime(run.at)}</span>
        <span>{run.userRole}</span>
        <span>{run.model}</span>
        <span>{ms(run.durationMs)}</span>
        {run.threadId && <span className="font-mono">thread {run.threadId}</span>}
      </div>
      {run.usage && (
        <p className="font-mono text-sm text-indigo-300">
          Tokens: in {run.usage.inputTokens} / out {run.usage.outputTokens} / total {run.usage.totalTokens}
        </p>
      )}
      {run.guardrailNotes.length > 0 && (
        <div className="text-sm text-amber-300">
          {run.guardrailNotes.map((n, i) => (
            <p key={i}>- {n}</p>
          ))}
        </div>
      )}
      <ErrorBox message={run.error ?? ''} />
      {run.steps.length === 0 && <Empty text="No steps recorded." />}
      <div className="space-y-1.5">
        {run.steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2" title={s.args ? JSON.stringify(s.args) : s.error}>
            <span className="w-40 shrink-0 truncate font-mono text-sm text-slate-300">
              <span className="text-slate-500">{s.type}</span> {s.name}
            </span>
            <div className="relative h-4 flex-1 rounded bg-slate-900">
              <div
                className={`absolute top-0 h-4 rounded ${s.success ? 'bg-indigo-500/80' : 'bg-rose-500/80'}`}
                style={{
                  left: `${(s.startOffsetMs / total) * 100}%`,
                  width: `${Math.max((s.durationMs / total) * 100, 0.5)}%`,
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right font-mono text-sm text-slate-400">{ms(s.durationMs)}</span>
          </div>
        ))}
      </div>
      {run.steps.some((s) => s.error) && (
        <div className="text-sm text-rose-400">
          {run.steps.filter((s) => s.error).map((s, i) => (
            <p key={i}>{s.name}: {s.error}</p>
          ))}
        </div>
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
    <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-5">
      <div className="flex items-center justify-between border-b border-slate-700 pb-4">
        <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
          <Activity className="h-5 w-5 text-rose-400" /> Agent observability
          {metrics && (
            <span className={`rounded px-2 py-0.5 text-xs font-bold normal-case ${breakerCls[metrics.breaker.state]}`}>
              Breaker: {metrics.breaker.state}
              {metrics.breaker.consecutiveFailures > 0 && ` (${metrics.breaker.consecutiveFailures} failures)`}
            </span>
          )}
        </h3>
        <button onClick={load} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-slate-300 hover:text-white border border-slate-700">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {loading && !metrics && <Loading text="Loading agent metrics..." />}
      <ErrorBox message={metricsError} />

      {w && (
        <>
          <p className="text-sm text-slate-500">Last {w.hours}h window. Auto-refreshes every 30s.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Runs" value={String(w.runs)} />
            <Card label="Error rate" value={pct(w.errorRate)} />
            <Card label="Guardrail warnings" value={pct(w.guardrailWarnRate)} />
            <Card label="Tool failures" value={pct(w.toolFailureRate)} />
            <Card label="p50 latency" value={ms(w.p50LatencyMs)} />
            <Card label="p95 latency" value={ms(w.p95LatencyMs)} />
            <Card label="Avg tool calls" value={w.avgToolCalls.toFixed(1)} />
            <Card label="Avg tokens" value={Math.round(w.avgTokens).toString()} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-xl bg-slate-950 border border-slate-700 p-4 space-y-2">
              <p className="text-sm font-bold text-white">Drift</p>
              {w.runs < 20 ? (
                <p className="text-sm text-slate-500">Not enough data yet</p>
              ) : drift.length === 0 ? (
                <p className="text-sm text-emerald-400">No drift detected</p>
              ) : (
                drift.map((d, i) => (
                  <div key={i} className={`rounded-lg border p-2 text-sm ${sevCls[d.severity]}`}>
                    <p className="font-bold">
                      [{d.severity}] {d.metric}
                    </p>
                    <p>{d.message}</p>
                    <p className="font-mono opacity-80">current {d.current.toFixed(3)} / baseline {d.baseline.toFixed(3)}</p>
                  </div>
                ))
              )}
            </div>
            <div className="rounded-xl bg-slate-950 border border-slate-700 p-4 space-y-2">
              <p className="text-sm font-bold text-white">Top tools</p>
              {w.topTools.length === 0 && <p className="text-sm text-slate-500">No tool usage yet.</p>}
              {w.topTools.map((t) => (
                <div key={t.name} className="flex justify-between font-mono text-sm text-slate-300">
                  <span className="truncate">{t.name}</span>
                  <span className="text-indigo-400">{t.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="space-y-3">
        <p className="text-sm font-bold text-white">Recent runs (latest 50)</p>
        {loading && !runs && <Loading text="Loading runs..." />}
        <ErrorBox message={runsError} />
        {runs && runs.length === 0 && <Empty text="No agent runs recorded." />}
        {runs && runs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                  <th className="pb-2 px-2">Time</th><th className="pb-2 px-2">Status</th><th className="pb-2 px-2">Role</th><th className="pb-2 px-2">Model</th><th className="pb-2 px-2">Duration</th><th className="pb-2 px-2">Guardrail</th><th className="pb-2 px-2">Tools</th><th className="pb-2 px-2">Retries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {runs.map((r) => (
                  <tr key={r.id} onClick={() => selectRun(r.id)} className={`cursor-pointer hover:bg-slate-800/40 ${r.id === selectedId ? 'bg-slate-800/60' : ''}`}>
                    <td className="py-2 px-2 whitespace-nowrap">{fmtTime(r.at)}</td>
                    <td className={`py-2 px-2 font-bold ${r.status === 'OK' ? 'text-emerald-400' : 'text-rose-400'}`}>{r.status}</td>
                    <td className="py-2 px-2">{r.userRole}</td>
                    <td className="py-2 px-2">{r.model}</td>
                    <td className="py-2 px-2 whitespace-nowrap">{ms(r.durationMs)}</td>
                    <td className={`py-2 px-2 ${r.guardrailStatus === 'WARNING' ? 'text-amber-400' : ''}`}>{r.guardrailStatus}</td>
                    <td className="py-2 px-2">{r.toolCalls}</td>
                    <td className="py-2 px-2">{r.retries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selectedId && detailLoading && <Loading text="Loading run..." />}
        <ErrorBox message={detailError} />
        {detail && <Waterfall run={detail} />}
      </div>
    </div>
  );
};
