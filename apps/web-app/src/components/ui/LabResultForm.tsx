'use client';

import React, { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { LabResultResponse, Patient } from '../../lib/types';
import { isActiveStatus } from '../../lib/visits';
import { ErrorBox, SuccessBox } from './common';
import { Button, Field, Input } from './kit';

interface Props {
  patientId: string;
  /** Whether the patient has an open visit. When omitted the form looks it up itself. */
  open?: boolean;
  onSaved?: () => void;
  /** Deprecated: the button now always uses the design-system primary style. Kept so callers still compile. */
  accent?: string;
}

const EMPTY = { testName: '', value: '', unit: '', referenceRange: '' };

/** POST /hospital/lifecycle/lab-result. Status (normal/abnormal/critical) is computed by the server. */
export const LabResultForm: React.FC<Props> = ({ patientId, open, onSaved }) => {
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
    <form data-testid="lab-form" onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-2">
        <FlaskConical className="h-4 w-4 text-ink-3" aria-hidden /> Add lab result
      </p>
      {!patientId && <p className="text-sm text-ink-3">Select a patient first.</p>}
      {patientId && !visitOpen && (
        <p className="text-sm font-semibold text-danger-700">{looked === null && open === undefined ? 'Checking visit...' : 'Patient has no open visit: lab entry is disabled.'}</p>
      )}
      <fieldset disabled={!patientId || !visitOpen} className={`min-w-0 space-y-3 ${!visitOpen ? 'opacity-50' : ''}`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Test name *" className="sm:col-span-2">
            {(id) => <Input id={id} required value={lab.testName} onChange={(e) => setLab({ ...lab, testName: e.target.value })} />}
          </Field>
          <Field label="Value *">
            {(id) => <Input id={id} required value={lab.value} onChange={(e) => setLab({ ...lab, value: e.target.value })} />}
          </Field>
          <Field label="Unit *">
            {(id) => <Input id={id} required value={lab.unit} onChange={(e) => setLab({ ...lab, unit: e.target.value })} />}
          </Field>
          <Field label="Reference range" className="sm:col-span-2">
            {(id) => <Input id={id} value={lab.referenceRange} onChange={(e) => setLab({ ...lab, referenceRange: e.target.value })} />}
          </Field>
        </div>
        <ErrorBox message={error} />
        <SuccessBox message={msg} />
        <Button type="submit" loading={busy} data-testid="lab-save" className="w-full">
          {busy ? 'Saving...' : 'Save lab result'}
        </Button>
      </fieldset>
    </form>
  );
};
