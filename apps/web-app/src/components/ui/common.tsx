'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import type { Safety } from '../../lib/types';
import { PRIORITY_BADGE, STATUS_BADGE, type VisitSummary } from '../../lib/visits';

export const inputCls =
  'w-full min-h-11 rounded-xl bg-slate-950 px-4 py-2.5 text-base text-white border border-slate-700 placeholder:text-slate-500 focus:outline-none focus:border-indigo-400';
export const labelCls = 'block text-sm font-semibold text-slate-200 mb-1.5';

export const ErrorBox: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-4 text-sm font-semibold text-rose-300">
      <AlertCircle className="h-5 w-5 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  ) : null;

export const SuccessBox: React.FC<{ message: string }> = ({ message }) =>
  message ? (
    <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-sm font-semibold text-emerald-300">
      <CheckCircle2 className="h-5 w-5 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  ) : null;

export const Loading: React.FC<{ text?: string }> = ({ text = 'Loading...' }) => (
  <div className="flex items-center gap-3 py-6 text-base text-slate-300" role="status" aria-live="polite">
    <Loader2 className="h-5 w-5 animate-spin text-indigo-300" /> {text}
  </div>
);

export const Empty: React.FC<{ text: string }> = ({ text }) => (
  <p className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-8 text-center text-base text-slate-400">{text}</p>
);

export const AiDraftBanner: React.FC = () => (
  <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 text-sm font-semibold text-amber-200">
    <ShieldAlert className="h-5 w-5 shrink-0" />
    AI-generated draft – clinician review required
  </div>
);

export const SafetyPanel: React.FC<{ safety: Safety }> = ({ safety }) => {
  const color =
    safety.status === 'SAFE'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : safety.status === 'WARNING'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return (
    <div className={`rounded-xl border p-4 text-sm space-y-2 ${color}`}>
      <p className="font-bold">Medication safety: {safety.status}</p>
      {safety.findings.length === 0 && <p>No findings.</p>}
      {safety.findings.map((f, i) => (
        <p key={i}>
          <span className="font-bold">[{f.severity}] {f.drug}</span> ({f.type}): {f.message}
        </p>
      ))}
    </div>
  );
};

export const fmtTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/** Split comma/newline separated text into trimmed non-empty items. */
export const splitList = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export const StatusBadge: React.FC<{ visit?: VisitSummary | null }> = ({ visit }) =>
  visit ? (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold border whitespace-nowrap ${STATUS_BADGE[visit.status]}`}>{visit.statusLabel}</span>
  ) : (
    <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold border bg-slate-700/40 text-slate-400 border-slate-600">No visit</span>
  );

export const PriorityBadge: React.FC<{ priority?: number | null }> = ({ priority }) =>
  priority ? (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold border ${PRIORITY_BADGE[priority] ?? PRIORITY_BADGE[5]}`} title="Priority (1 = most urgent)">P{priority}</span>
  ) : (
    <span className="text-slate-500">—</span>
  );

export const fmtWait = (m?: number | null) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);
