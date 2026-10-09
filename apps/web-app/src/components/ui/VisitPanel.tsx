'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import { useRealtime } from '../../context/RoleContext';
import { statusLabel, transitionLabel, type TransitionOption, type VisitDetail, type VisitSummary } from '../../lib/visits';
import { ErrorBox, Loading, PriorityBadge, StatusBadge, fmtTime } from './common';
import { Button, Field, Input } from './kit';

interface Props {
  visitId: string;
  /** Called after a transition succeeded so the parent can refresh its lists. */
  onChanged?: () => void;
}

/** Visit timeline plus the buttons the backend allows for this user (note prompt when `noteRequired`). */
export const VisitPanel: React.FC<Props> = ({ visitId, onChanged }) => {
  const [detail, setDetail] = useState<VisitDetail | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<TransitionOption | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await apiFetch<VisitDetail>(`/hospital/visits/${encodeURIComponent(visitId)}`));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [visitId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setPending(null);
    setNote('');
  }, [load]);
  useRealtime(['visit.updated'], load);

  const run = async (t: TransitionOption, text: string) => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/hospital/visits/${encodeURIComponent(visitId)}/transition`, {
        method: 'POST',
        body: { to: t.to, ...(text.trim() ? { note: text.trim() } : {}), ...(t.to === 'COMPLETED' ? { outcome: 'DISCHARGED' } : {}) },
      });
      setPending(null);
      setNote('');
      await load();
      onChanged?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const click = (t: TransitionOption) => {
    if (t.noteRequired || t.to === 'COMPLETED') {
      setPending(t);
      setNote('');
    } else run(t, '');
  };

  if (!detail) return error ? <ErrorBox message={error} /> : <Loading text="Loading visit..." />;
  const v = detail.visit;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-muted p-4 text-sm" data-testid="visit-panel">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-1.5 font-semibold text-ink-2"><History className="h-4 w-4 text-ink-3" aria-hidden /> Current visit</p>
        <StatusBadge visit={v} />
        <PriorityBadge priority={v.priority} />
        {v.primaryDoctorName && <span className="text-ink-3">Doctor: {v.primaryDoctorName}</span>}
      </div>
      <p className="text-ink-2">Chief complaint: {v.chiefComplaint || '—'}</p>

      {detail.allowedTransitions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {detail.allowedTransitions.map((t) => (
            <Button
              key={t.to}
              size="sm"
              variant={t.to === 'COMPLETED' || t.from === 'COMPLETED' ? 'primary' : 'secondary'}
              disabled={busy}
              onClick={() => click(t)}
            >
              {transitionLabel(t)}
            </Button>
          ))}
        </div>
      )}

      {pending && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
          <Field label={`${transitionLabel(pending)}: ${pending.noteRequired ? 'reason (required)' : 'note (optional)'}`}>
            {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || (!!pending.noteRequired && !note.trim())} loading={busy} onClick={() => run(pending, note)}>
              {busy ? 'Working...' : 'Confirm'}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ErrorBox message={error} />

      <div>
        <p className="mb-1 font-semibold text-ink-2">Timeline</p>
        <ul className="space-y-1 text-ink-2">
          {detail.timeline.map((t, i) => (
            <li key={i}>
              <span className="text-ink-3">{fmtTime(t.at)}</span> — {t.fromStatus ? `${statusLabel(t.fromStatus)} → ` : ''}<span className="font-semibold text-ink">{statusLabel(t.toStatus)}</span>
              {t.actorName && <span className="text-ink-3"> by {t.actorName}</span>}
              {t.note && <span className="text-ink-3"> — {t.note}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/** Compact list of a patient's past and current visits. */
export const VisitHistory: React.FC<{ visits: VisitSummary[] }> = ({ visits }) =>
  visits.length === 0 ? (
    <p className="text-sm text-ink-3">No visits yet.</p>
  ) : (
    <ul className="space-y-1 text-sm text-ink-2">
      {visits.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-2">
          <span className="text-ink-3">{fmtTime(v.arrivedAt)}</span>
          <StatusBadge visit={v} />
          <span>{v.chiefComplaint || '—'}</span>
          {v.primaryDoctorName && <span className="text-ink-3">• {v.primaryDoctorName}</span>}
          {v.outcome && <span className="text-ink-3">• {v.outcome}</span>}
          {v.closeReason && <span className="text-ink-3">• {v.closeReason}</span>}
        </li>
      ))}
    </ul>
  );
