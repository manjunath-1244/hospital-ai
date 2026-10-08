'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Activity, ShieldAlert, Sparkles, ListOrdered } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import type { Consciousness, QueueItem, QueueResponse, TriagePayload, TriageResponse } from '../../lib/types';
import { isActiveStatus } from '../../lib/visits';
import { Empty, ErrorBox, PriorityBadge, StatusBadge, fmtWait, inputCls, labelCls, splitList } from '../ui/common';
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
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type="number"
        step={step}
        required={required}
        value={vitals[key]}
        onChange={(e) => setVitals({ ...vitals, [key]: e.target.value })}
        className={`${inputCls} font-mono`}
      />
    </div>
  );

  const riskColor =
    result?.riskLevel === 'HIGH'
      ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
      : result?.riskLevel === 'MEDIUM'
      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
      : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl glass-panel p-7 border-l-4 border-l-amber-500">
        <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          ED Triage: NEWS2, SIRS & Suggested ESI
        </h2>
        <p className="text-base text-slate-300 mt-1.5">Vitals are submitted to the backend, which computes all scores. Suggested ESI is decision support only.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="lg:col-span-2 glass-panel p-7 rounded-2xl border border-slate-700 space-y-3">
          <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
            <ListOrdered className="h-5 w-5 text-amber-400" /> Waiting for Triage ({queue.length})
          </h3>
          <ErrorBox message={queueError} />
          {queue.length === 0 && !queueError && <Empty text="No patients are waiting for triage." />}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {queue.map((i) => (
              <button
                key={i.visit.id}
                type="button"
                onClick={() => {
                  setPatientId(i.patientId);
                  setPatientClosed(false);
                }}
                className={`text-left rounded-xl border p-3 text-sm transition-all ${patientId === i.patientId ? 'bg-amber-500/10 border-amber-400' : 'bg-slate-950 border-slate-800 hover:border-slate-600'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-white">{i.name}</p>
                  <StatusBadge visit={i.visit} />
                </div>
                <p className="text-slate-400">{i.age ?? '?'}y {i.gender ?? ''} • waiting {fmtWait(i.visit.waitMinutes)} <PriorityBadge priority={i.visit.priority} /></p>
                <p className="text-slate-300 truncate">{i.chiefComplaint}</p>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
          <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
            <Activity className="h-5 w-5 text-amber-400" /> Triage Vitals Entry
          </h3>
          <PatientPicker
            value={patientId}
            onChange={(id, p) => {
              setPatientId(id);
              setPatientClosed(!!id && !isActiveStatus(p?.visit?.status));
            }}
          />
          {patientClosed && <ErrorBox message="This patient has no open visit. The front desk must start a new visit before triage." />}
          <div className="grid grid-cols-2 gap-3">
            {num('heartRate', 'Heart Rate (bpm)')}
            {num('bpSystolic', 'Systolic BP (mmHg)')}
            {num('spO2', 'SpO2 (%)')}
            {num('tempCelsius', 'Temperature (°C)', true, '0.1')}
            {num('respiratoryRate', 'Respiratory Rate (/min)')}
            {num('painScore', 'Pain score (0-10, optional)', false)}
            {num('glucoseMgDl', 'Glucose (mg/dL, optional)', false)}
          </div>
          <div>
            <label className={labelCls}>Symptoms (comma separated, optional)</label>
            <input value={symptoms} onChange={(e) => setSymptoms(e.target.value)} className={inputCls} placeholder="e.g. chest pain, shortness of breath" />
            {splitList(symptoms).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {splitList(symptoms).map((sym, i) => (
                  <span key={i} className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-xs font-semibold text-amber-200">{sym}</span>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className={labelCls}>Priority override (ESI)</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
              <option value="">Automatic (use suggested ESI)</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}{n === 1 ? ' – most urgent' : n === 5 ? ' – least urgent' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Consciousness (ACVPU)</label>
            <select value={consciousness} onChange={(e) => setConsciousness(e.target.value as Consciousness)} className={inputCls}>
              {(['ALERT', 'CONFUSION', 'VOICE', 'PAIN', 'UNRESPONSIVE'] as Consciousness[]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={onSupplementalO2} onChange={(e) => setOnSupplementalO2(e.target.checked)} />
            On supplemental oxygen
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={spo2Scale2} onChange={(e) => setSpo2Scale2(e.target.checked)} />
            Use SpO2 Scale 2 (hypercapnic respiratory failure)
          </label>
          <ErrorBox message={error} />
          <button
            type="submit"
            disabled={loading || !patientId || patientClosed}
            className="w-full rounded-xl bg-gradient-to-r from-amber-600 to-rose-600 py-3 text-base font-bold text-white  disabled:opacity-50"
          >
            {loading ? 'Submitting...' : 'Submit triage vitals'}
          </button>
        </form>

        <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
          <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
            <Sparkles className="h-5 w-5 text-amber-400" /> Triage Result
          </h3>
          {result ? (
            <div className="space-y-4">
              <div className={`rounded-xl border p-4 text-sm space-y-2 ${riskColor}`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5" /> NEWS2 {result.news2Score}
                  </span>
                  <span className="rounded-full bg-slate-950/60 px-3 py-0.5 text-xs font-black">{result.riskLevel}</span>
                </div>
                <p className="font-bold">Suggested ESI level: {result.suggestedEsiLevel}</p>
                <p className="text-slate-200 font-medium">{result.rationale}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-950 p-4 border border-slate-700 text-sm text-slate-300">
                Visit is now <StatusBadge visit={result.visit} /> with priority <PriorityBadge priority={result.visit.priority} />
              </div>
              <div className="rounded-xl bg-slate-950 p-4 border border-slate-700 text-sm">
                <p className="font-bold text-indigo-400 mb-2">NEWS2 breakdown</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-slate-300">
                  {Object.entries(result.breakdown).map(([k, v]) => (
                    <div key={k} className="flex justify-between"><span className="text-slate-400">{k}</span><span>{v}</span></div>
                  ))}
                </div>
              </div>
              <div className={`rounded-xl p-4 border text-sm ${result.sirs.positive ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-slate-950 border-slate-800 text-slate-300'}`}>
                <p className="font-bold">SIRS: {result.sirs.count} criteria {result.sirs.positive ? '(positive)' : '(negative)'}</p>
                {result.sirs.criteria.map((c, i) => (
                  <p key={i}>- {c}</p>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl bg-slate-950/50 border border-dashed border-slate-800 text-slate-500 text-sm">
              Submit vitals to see the backend-computed result.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
