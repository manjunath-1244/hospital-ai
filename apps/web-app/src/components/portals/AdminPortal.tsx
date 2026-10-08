'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Shield, Cpu, RefreshCw } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { AuditLogEntry, HealthResponse } from '../../lib/types';
import { AgentObservability } from './AgentObservability';
import { KnowledgeBasePanel } from './KnowledgeBasePanel';
import { PatientManagementPanel } from './PatientManagementPanel';
import { Empty, ErrorBox, Loading, fmtTime } from '../ui/common';

export const AdminPortal: React.FC = () => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState('');
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [logsError, setLogsError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [h, l] = await Promise.allSettled([
      apiFetch<HealthResponse>('/admin/health'),
      apiFetch<AuditLogEntry[]>('/admin/audit-logs?limit=100'),
    ]);
    if (h.status === 'fulfilled') {
      setHealth(h.value);
      setHealthError('');
    } else setHealthError(errorMessage(h.reason));
    if (l.status === 'fulfilled') {
      setLogs(l.value);
      setLogsError('');
    } else setLogsError(errorMessage(l.reason));
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-2xl glass-panel p-7 border-l-4 border-l-rose-500">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <Shield className="h-8 w-8 text-rose-400" />
            Administration: Service Health & Audit Log
          </h2>
          <p className="text-base text-slate-300 mt-1.5">Live data from the backend. {health && `Last checked ${fmtTime(health.checkedAt)}.`}</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-slate-300 hover:text-white border border-slate-700">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
        <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
          <Cpu className="h-5 w-5 text-rose-400" /> Service Health
        </h3>
        {loading && !health && <Loading text="Checking services..." />}
        <ErrorBox message={healthError} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          {health?.services.map((s) => (
            <div key={s.name} className="rounded-xl bg-slate-950 p-4 border border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">{s.name}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${s.status === 'UP' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>{s.status}</span>
              </div>
              <p className="text-slate-400 text-sm break-words">{s.details}</p>
              <p className="text-sm font-mono text-indigo-400">Latency: {s.latencyMs} ms</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
        <h3 className="text-xl font-semibold text-white tracking-tight border-b border-slate-700 pb-4">Audit Log (latest 100)</h3>
        {loading && !logs && <Loading text="Loading audit log..." />}
        <ErrorBox message={logsError} />
        {logs && logs.length === 0 && <Empty text="No audit entries." />}
        {logs && logs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                  <th className="pb-2 px-2">Time</th><th className="pb-2 px-2">Role</th><th className="pb-2 px-2">User</th><th className="pb-2 px-2">Request</th><th className="pb-2 px-2">Patient</th><th className="pb-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 px-2 whitespace-nowrap">{fmtTime(l.at)}</td>
                    <td className="py-2 px-2">{l.role}</td>
                    <td className="py-2 px-2">{l.userId}</td>
                    <td className="py-2 px-2 break-all"><span className="font-bold">{l.method}</span> {l.path}</td>
                    <td className="py-2 px-2">{l.patientId ?? '—'}</td>
                    <td className={`py-2 px-2 ${l.statusCode >= 400 ? 'text-rose-400' : 'text-emerald-400'}`}>{l.statusCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <KnowledgeBasePanel />
      <PatientManagementPanel />

      <AgentObservability />
    </div>
  );
};
