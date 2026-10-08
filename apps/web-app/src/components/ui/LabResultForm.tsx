'use client';

import React, { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { LabResultResponse, Patient } from '../../lib/types';
import { isActiveStatus } from '../../lib/visits';
import { ErrorBox, SuccessBox, inputCls, labelCls } from './common';

interface Props {
  patientId: string;
  /** Whether the patient has an open visit. When omitted the form looks it up itself. */
  open?: boolean;
  onSaved?: () => void;
  accent?: string;
}

const EMPTY = { testName: '', value: '', unit: '', referenceRange: '' };

/** POST /hospital/lifecycle/lab-result. Status (normal/abnormal/critical) is computed by the server. */
export const LabResultForm: React.FC<Props> = ({ patientId, open, onSaved, accent = 'bg-indigo-600 hover:bg-indigo-500' }) => {
  const [lab, setLab] = useState(EMPTY);
  const [looked, setLooked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMsg('');
    setError('');
    if (open !== undefined || !patientId) return;
    let cancelled = false;
    setLooked(null);
    apiFetch<Patient>(`/hospital/patients/${encodeURIComponent(patientId)}`)
      .then((p) => !cancelled && setLooked(isActiveStatus(p.visit?.status)))
      .catch(() => !cancelled && setLooked(false));
    return () => {
      cancelled = true;
    };
  }, [patientId, open]);

  const visitOpen = open ?? looked ?? false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const res = await apiFetch<LabResultResponse>('/hospital/lifecycle/lab-result', {
        method: 'POST',
        body: {
          patientId,
          testName: lab.testName.trim(),
          value: lab.value.trim(),
          unit: lab.unit.trim(),
          ...(lab.referenceRange.trim() ? { referenceRange: lab.referenceRange.trim() } : {}),
        },
      });
      setMsg(`Lab result recorded (${res.lab.status})${res.isCritical ? ' - CRITICAL value, alert raised' : ''}.`);
      setLab(EMPTY);
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-testid="lab-form" onSubmit={submit} className="rounded-xl bg-slate-950 p-4 border border-slate-700 space-y-3">
      <p className="font-bold text-slate-300 text-sm uppercase flex items-center gap-1">
        <FlaskConical className="h-4 w-4" /> Add lab result
      </p>
      {!patientId && <p className="text-base text-slate-400">Select a patient first.</p>}
      {patientId && !visitOpen && <p className="text-base font-semibold text-rose-400">{looked === null && open === undefined ? 'Checking visit...' : 'Patient has no open visit: lab entry is disabled.'}</p>}
      <fieldset disabled={!patientId || !visitOpen} className={`space-y-3 min-w-0 ${!visitOpen ? 'opacity-50' : ''}`}>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Test name *</label>
            <input required value={lab.testName} onChange={(e) => setLab({ ...lab, testName: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Value *</label>
            <input required value={lab.value} onChange={(e) => setLab({ ...lab, value: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Unit *</label>
            <input required value={lab.unit} onChange={(e) => setLab({ ...lab, unit: e.target.value })} className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Reference range</label>
            <input value={lab.referenceRange} onChange={(e) => setLab({ ...lab, referenceRange: e.target.value })} className={inputCls} />
          </div>
        </div>
        <ErrorBox message={error} />
        <SuccessBox message={msg} />
        <button type="submit" disabled={busy} className={`w-full rounded-xl py-3 text-base font-bold text-white disabled:opacity-50 ${accent}`}>
          {busy ? 'Saving...' : 'Save lab result'}
        </button>
      </fieldset>
    </form>
  );
};
