'use client';

import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Alert, EmptyState, Spinner, TONE_BADGE, fieldInputCls } from './kit';
import type { Safety } from '../../lib/types';
import { PRIORITY_BADGE, STATUS_BADGE, type VisitSummary } from '../../lib/visits';

export const inputCls = fieldInputCls;
export const labelCls = 'block text-sm font-medium text-ink mb-1.5';

export const ErrorBox: React.FC<{ message: string }> = ({ message }) =>
  message ? <Alert tone="danger" testId="error-banner">{message}</Alert> : null;

export const SuccessBox: React.FC<{ message: string }> = ({ message }) =>
  message ? <Alert tone="success" live="polite">{message}</Alert> : null;

export const Loading: React.FC<{ text?: string }> = ({ text = 'Loading...' }) => <Spinner text={text} />;

export const Empty: React.FC<{ text: string }> = ({ text }) => <EmptyState title={text} />;

export const AiDraftBanner: React.FC = () => (
  <Alert tone="warning">
    <span className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4 shrink-0" aria-hidden /> AI-generated draft – clinician review required</span>
  </Alert>
);

export const SafetyPanel: React.FC<{ safety: Safety }> = ({ safety }) => (
  <Alert tone={safety.status === 'SAFE' ? 'success' : safety.status === 'WARNING' ? 'warning' : 'danger'} title={`Medication safety: ${safety.status}`}>
    {safety.findings.length === 0 && <p>No findings.</p>}
    {safety.findings.map((f, i) => (
      <p key={i}>
        <span className="font-semibold">[{f.severity}] {f.drug}</span> ({f.type}): {f.message}
      </p>
    ))}
  </Alert>
);

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
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold border whitespace-nowrap ${STATUS_BADGE[visit.status]}`}>{visit.statusLabel}</span>
  ) : (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold border ${TONE_BADGE.neutral}`}>No visit</span>
  );

export const PriorityBadge: React.FC<{ priority?: number | null }> = ({ priority }) =>
  priority ? (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold border ${PRIORITY_BADGE[priority] ?? PRIORITY_BADGE[5]}`} title="Priority (1 = most urgent)">P{priority}</span>
  ) : (
    <span className="text-ink-3">—</span>
  );

export const fmtWait = (m?: number | null) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);
