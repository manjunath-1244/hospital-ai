'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Pill, ShieldCheck } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { PharmacyQueueItem, Safety } from '../../lib/types';
import { Empty, ErrorBox, Loading, SafetyPanel, fmtTime, inputCls, labelCls, splitList } from '../ui/common';
import { PatientPicker } from '../ui/PatientPicker';
import { useRealtime } from '../../context/RoleContext';

export const PharmacyPortal: React.FC = () => {
  const [queue, setQueue] = useState<PharmacyQueueItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [patientId, setPatientId] = useState('');
  const [meds, setMeds] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [audit, setAudit] = useState<Safety | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await apiFetch<PharmacyQueueItem[]>('/hospital/pharmacy/queue'));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  useRealtime(['doctor.consulted'], load);

  const runAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuditing(true);
    setAuditError('');
    setAudit(null);
    try {
      setAudit(await apiFetch<Safety>('/hospital/pharmacy/audit', { method: 'POST', body: { patientId, medications: splitList(meds) } }));
    } catch (err) {
      setAuditError(errorMessage(err));
    } finally {
      setAuditing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl glass-panel p-7 border-l-4 border-l-purple-500">
        <div>
        <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <Pill className="h-8 w-8 text-purple-400" />
          Clinical Pharmacy: Prescription Queue & Safety Audit
        </h2>
        <p className="text-base text-slate-300 mt-1.5">Review recent prescriptions with their safety findings, or audit medications ad hoc.</p>
        </div>
        <div className="rounded-xl bg-slate-950 px-5 py-3 text-center border border-slate-700 min-w-28">
            <p className="text-sm text-slate-300">In queue</p>
            <p className="text-3xl font-extrabold text-purple-300">{queue?.length ?? '—'}</p>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={runAudit} className="lg:col-span-1 glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
          <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
            <ShieldCheck className="h-5 w-5 text-purple-400" /> Ad-hoc Medication Audit
          </h3>
          <PatientPicker value={patientId} onChange={setPatientId} />
          <div>
            <label className={labelCls}>Medications (comma or line separated)</label>
            <textarea rows={3} required value={meds} onChange={(e) => setMeds(e.target.value)} className={inputCls} />
          </div>
          <ErrorBox message={auditError} />
          <button
            type="submit"
            disabled={auditing || !patientId || splitList(meds).length === 0}
            className="w-full rounded-xl bg-purple-600 py-3 text-base font-bold text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {auditing ? 'Auditing...' : 'Run safety audit'}
          </button>
          {audit && <SafetyPanel safety={audit} />}
        </form>

        <div className="lg:col-span-2 glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
          <h3 className="text-xl font-semibold text-white tracking-tight border-b border-slate-700 pb-4">Prescription Queue</h3>
          {loading && <Loading text="Loading queue..." />}
          <ErrorBox message={error} />
          {!loading && !error && queue?.length === 0 && <Empty text="No prescriptions in the queue." />}
          <div className="space-y-3">
            {queue?.map((item) => (
              <div key={item.consultationId} className="rounded-xl bg-slate-950 border border-slate-700 p-4 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-white">{item.patientName} <span className="font-mono text-indigo-400">({item.patientId})</span></p>
                  <span className="text-sm text-slate-500">{item.doctorName} • {fmtTime(item.createdAt)}</span>
                </div>
                <p className="text-slate-300">{item.prescriptions.length ? item.prescriptions.join(', ') : 'No prescriptions'}</p>
                <SafetyPanel safety={item.safety} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
