'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Activity, ShieldAlert, Sparkles, ListOrdered } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import type { Consciousness, QueueItem, QueueResponse, TriagePayload, TriageResponse } from '../../lib/types';
import { isActiveStatus } from '../../lib/visits';
import { ErrorBox, PriorityBadge, StatusBadge, fmtWait, splitList } from '../ui/common';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, SectionTitle, Select, cx, TONE_ALERT, type Tone } from '../ui/kit';
import { PatientPicker } from '../ui/PatientPicker';

const emptyVitals = { heartRate: '', bpSystolic: '', spO2: '', tempCelsius: '', respiratoryRate: '', painScore: '', glucoseMgDl: '' };

export const EdTriagePortal: React.FC = () => {
  const [patientId, setPatientId] = useState('');
  const [patientClosed, setPatientClosed] = useState(false);
  const [symptoms, setSymptoms] = useState('');
  const [priority, setPriority] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueError, setQueueError] = useState('');
  const [vitals, setVitals] = useState(emptyVitals);
  const [consciousness, setConsciousness] = useState<Consciousness>('ALERT');
  const [onSupplementalO2, setOnSupplementalO2] = useState(false);
  const [spo2Scale2, setSpo2Scale2] = useState(false);
  const [result, setResult] = useState<TriageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadQueue = useCallback(async () => {
    try {
      const r = await apiFetch<QueueResponse>('/hospital/lifecycle/queue');
      setQueue(r.items.filter((i) => i.visit.status === 'WAITING_TRIAGE'));
      setQueueError('');
    } catch (e) {
      setQueueError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadQueue();
  }, [loadQueue]);
  useRealtime(['patient.registered', 'visit.updated'], loadQueue);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    const payload: TriagePayload = {
      patientId,
      heartRate: Number(vitals.heartRate),
      bpSystolic: Number(vitals.bpSystolic),
      spO2: Number(vitals.spO2),
      tempCelsius: Number(vitals.tempCelsius),
      respiratoryRate: Number(vitals.respiratoryRate),
      consciousness,
      onSupplementalO2,
      ...(vitals.painScore !== '' ? { painScore: Number(vitals.painScore) } : {}),
      ...(spo2Scale2 ? { spo2Scale2: true } : {}),
      ...(splitList(symptoms).length ? { symptoms: splitList(symptoms) } : {}),
      ...(vitals.glucoseMgDl !== '' ? { glucoseMgDl: Number(vitals.glucoseMgDl) } : {}),
      ...(priority ? { priority: Number(priority) } : {}),
    };
    try {
      setResult(await apiFetch<TriageResponse>('/hospital/lifecycle/triage', { method: 'POST', body: payload }));
      setSymptoms('');
      setPriority('');
      setVitals(emptyVitals);
      loadQueue();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const num = (key: keyof typeof emptyVitals, label: string, required = true, step = '1') => (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          type="number"
          step={step}
          required={required}
          value={vitals[key]}
          onChange={(e) => setVitals({ ...vitals, [key]: e.target.value })}
          className="font-mono"
        />
      )}
    </Field>
  );

  const riskTone: Tone = result?.riskLevel === 'HIGH' ? 'danger' : result?.riskLevel === 'MEDIUM' ? 'warning' : 'success';

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<AlertTriangle className="h-6 w-6" />}
        title="ED Triage: NEWS2, SIRS & Suggested ESI"
        subtitle="Vitals are submitted to the backend, which computes all scores. Suggested ESI is decision support only."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <SectionTitle icon={<ListOrdered className="h-5 w-5" />}>Waiting for Triage ({queue.length})</SectionTitle>
          <div className="space-y-3">
            <ErrorBox message={queueError} />
            {queue.length === 0 && !queueError && <EmptyState title="No patients are waiting for triage." hint="Newly registered patients appear here until their vitals are entered." />}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {queue.map((i) => (
                <button
                  key={i.visit.id}
                  type="button"
                  data-testid="triage-queue-item"
                  aria-pressed={patientId === i.patientId}
                  onClick={() => {
                    setPatientId(i.patientId);
                    setPatientClosed(false);
                  }}
                  className={cx(
                    'min-h-11 rounded-lg border p-3 text-left text-sm',
                    patientId === i.patientId ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:bg-surface-muted',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{i.name}</p>
                    <StatusBadge visit={i.visit} />
                  </div>
                  <p className="mt-1 text-ink-3">{i.age ?? '?'}y {i.gender ?? ''} • waiting {fmtWait(i.visit.waitMinutes)} <PriorityBadge priority={i.visit.priority} /></p>
                  <p className="truncate text-ink-2">{i.chiefComplaint}</p>
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card as="div">
          <form onSubmit={submit} className="space-y-4">
            <SectionTitle icon={<Activity className="h-5 w-5" />} className="mb-0">Triage Vitals Entry</SectionTitle>
            <PatientPicker
              value={patientId}
              onChange={(id, p) => {
                setPatientId(id);
                setPatientClosed(!!id && !isActiveStatus(p?.visit?.status));
              }}
            />
            {patientClosed && <ErrorBox message="This patient has no open visit. The front desk must start a new visit before triage." />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {num('heartRate', 'Heart Rate (bpm)')}
              {num('bpSystolic', 'Systolic BP (mmHg)')}
              {num('spO2', 'SpO2 (%)')}
              {num('tempCelsius', 'Temperature (°C)', true, '0.1')}
              {num('respiratoryRate', 'Respiratory Rate (/min)')}
              {num('painScore', 'Pain score (0-10, optional)', false)}
              {num('glucoseMgDl', 'Glucose (mg/dL, optional)', false)}
            </div>
            <Field label="Symptoms (comma separated, optional)">
              {(id) => (
                <>
                  <Input id={id} value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder="e.g. chest pain, shortness of breath" />
                  {splitList(symptoms).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {splitList(symptoms).map((sym, i) => (
                        <Badge key={i} tone="brand">{sym}</Badge>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Field>
            <Field label="Priority override (ESI)">
              {(id) => (
                <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="">Automatic (use suggested ESI)</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}{n === 1 ? ' – most urgent' : n === 5 ? ' – least urgent' : ''}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Consciousness (ACVPU)">
              {(id) => (
                <Select id={id} value={consciousness} onChange={(e) => setConsciousness(e.target.value as Consciousness)}>
                  {(['ALERT', 'CONFUSION', 'VOICE', 'PAIN', 'UNRESPONSIVE'] as Consciousness[]).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
            <label className="flex min-h-10 items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={onSupplementalO2} onChange={(e) => setOnSupplementalO2(e.target.checked)} />
              On supplemental oxygen
            </label>
            <label className="flex min-h-10 items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={spo2Scale2} onChange={(e) => setSpo2Scale2(e.target.checked)} />
              Use SpO2 Scale 2 (hypercapnic respiratory failure)
            </label>
            <ErrorBox message={error} />
            <Button type="submit" loading={loading} disabled={loading || !patientId || patientClosed} className="w-full" data-testid="triage-submit">
              {loading ? 'Submitting...' : 'Submit triage vitals'}
            </Button>
          </form>
        </Card>

        <Card>
          <SectionTitle icon={<Sparkles className="h-5 w-5" />}>Triage Result</SectionTitle>
          {result ? (
            <div className="space-y-4" aria-live="polite">
              <div className={cx('space-y-2 rounded-lg border p-4 text-sm', TONE_ALERT[riskTone])}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <ShieldAlert className="h-5 w-5" aria-hidden /> NEWS2 {result.news2Score}
                  </span>
                  <Badge tone={riskTone}>{result.riskLevel}</Badge>
                </div>
                <p className="font-semibold">Suggested ESI level: {result.suggestedEsiLevel}</p>
                <p className="font-medium">{result.rationale}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted p-4 text-sm text-ink-2">
                Visit is now <StatusBadge visit={result.visit} /> with priority <PriorityBadge priority={result.visit.priority} />
              </div>
              <div className="rounded-lg border border-line bg-surface-muted p-4 text-sm">
                <p className="mb-2 font-semibold text-ink">NEWS2 breakdown</p>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 font-mono text-ink-2 sm:grid-cols-2">
                  {Object.entries(result.breakdown).map(([k, v]) => (
                    <div key={k} className="flex justify-between"><span className="text-ink-3">{k}</span><span>{v}</span></div>
                  ))}
                </div>
              </div>
              <Alert tone={result.sirs.positive ? 'danger' : 'neutral'}>
                <p className="font-semibold">SIRS: {result.sirs.count} criteria {result.sirs.positive ? '(positive)' : '(negative)'}</p>
                {result.sirs.criteria.map((c, i) => (
                  <p key={i}>- {c}</p>
                ))}
              </Alert>
            </div>
          ) : (
            <EmptyState title="No result yet." hint="Submit vitals to see the backend-computed result." />
          )}
        </Card>
      </div>
    </div>
  );
};
