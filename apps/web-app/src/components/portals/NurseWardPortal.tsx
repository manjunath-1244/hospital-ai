'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Activity, FileText, Mic } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import type { DocumentResponse, WardEntry } from '../../lib/types';
import { LabResultForm } from '../ui/LabResultForm';
import { PendingActionsPanel } from './PendingActionsPanel';
import { AiDraftBanner, Empty, ErrorBox, Loading, fmtTime } from '../ui/common';

const riskCls = (r: string) =>
  r === 'HIGH' ? 'border-rose-500/50 bg-rose-500/10' : r === 'MEDIUM' || r === 'LOW_MEDIUM' ? 'border-amber-500/40 bg-amber-500/10' : 'border-slate-800 bg-slate-950';

export const NurseWardPortal: React.FC = () => {
  const [ward, setWard] = useState<WardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [sbar, setSbar] = useState<DocumentResponse | null>(null);
  const [sbarLoading, setSbarLoading] = useState(false);
  const [sbarError, setSbarError] = useState('');

  const load = useCallback(async () => {
    try {
      setWard(await apiFetch<WardEntry[]>('/hospital/lifecycle/ward'));
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
  useRealtime(['alert.news2_deterioration'], load);

  const generate = async () => {
    setSbarLoading(true);
    setSbarError('');
    setSbar(null);
    try {
      setSbar(await apiFetch<DocumentResponse>('/ai/documents', { method: 'POST', body: { type: 'SBAR', patientId: selected } }));
    } catch (e) {
      setSbarError(errorMessage(e));
    } finally {
      setSbarLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl glass-panel p-7 border-l-4 border-l-rose-500">
        <div>
        <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <Activity className="h-8 w-8 text-rose-400" />
          Ward Monitoring & SBAR Handoff
        </h2>
        <p className="text-base text-slate-300 mt-1.5">Latest recorded NEWS2 per patient, highest score first.</p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl bg-slate-950 px-5 py-3 text-center border border-slate-700 min-w-28">
            <p className="text-sm text-slate-300">Patients</p>
            <p className="text-3xl font-extrabold text-indigo-300">{ward?.length ?? '—'}</p>
          </div>
          <div className="rounded-xl bg-slate-950 px-5 py-3 text-center border border-slate-700 min-w-28">
            <p className="text-sm text-slate-300">High risk</p>
            <p className="text-3xl font-extrabold text-rose-300">{ward ? ward.filter((w) => w.latest.riskLevel === 'HIGH').length : '—'}</p>
          </div>
        </div>
      </div>

      <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
        <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
          <Activity className="h-5 w-5 text-rose-400" /> Ward NEWS2 Overview
        </h3>
        {loading && <Loading text="Loading ward..." />}
        <ErrorBox message={error} />
        {!loading && !error && ward?.length === 0 && <Empty text="No patients with recorded vitals." />}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {ward?.map((p) => (
            <button
              key={p.patientId}
              onClick={() => setSelected(p.patientId)}
              className={`text-left rounded-xl border p-4 text-sm space-y-1 transition-all ${riskCls(p.latest.riskLevel)} ${selected === p.patientId ? 'ring-2 ring-indigo-400' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">{p.name}</span>
                <span className="font-mono font-black text-white">NEWS2 {p.latest.news2Score}</span>
              </div>
              <p className="text-sm text-slate-400">{p.patientId} • {p.age}y {p.gender} • {p.latest.riskLevel}</p>
              <p className="font-mono text-sm text-slate-300">
                HR {p.latest.heartRate} | SBP {p.latest.bpSystolic} | SpO2 {p.latest.spO2}% | T {p.latest.tempCelsius} | RR {p.latest.respiratoryRate}
              </p>
              <p className="text-sm text-slate-500">{fmtTime(p.latest.recordedAt)}</p>
            </button>
          ))}
        </div>
      </div>

      <PendingActionsPanel />

      <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
        <h3 className="text-xl font-semibold text-white tracking-tight border-b border-slate-700 pb-4">Lab results</h3>
        <p className="text-base text-slate-300">
          {selected ? `Recording for ${ward?.find((w) => w.patientId === selected)?.name ?? selected} (${selected}).` : 'Select a patient card above to add a lab result.'}
        </p>
        <LabResultForm patientId={selected} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
          <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
            <FileText className="h-5 w-5 text-indigo-400" /> SBAR Handoff
          </h3>
          <p className="text-sm text-slate-400">
            {selected ? `Selected patient: ${ward?.find((w) => w.patientId === selected)?.name ?? selected}` : 'Select a patient card above.'}
          </p>
          <button
            onClick={generate}
            disabled={!selected || sbarLoading}
            className="w-full rounded-xl bg-indigo-600 py-3 text-base font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {sbarLoading ? 'Generating...' : 'Generate SBAR draft'}
          </button>
          <ErrorBox message={sbarError} />
          {sbar && (
            <div className="space-y-3">
              <AiDraftBanner />
              <pre className="whitespace-pre-wrap rounded-xl bg-slate-950 p-4 border border-slate-700 text-sm text-slate-200 font-sans">{sbar.content}</pre>
              <p className="text-sm text-slate-500">{sbar.disclaimer}</p>
            </div>
          )}
        </div>

        <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
          <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
            <Mic className="h-5 w-5 text-slate-500" /> Voice Scribe
          </h3>
          <button disabled className="w-full rounded-xl bg-slate-900 py-3 text-base font-bold text-slate-500 border border-slate-700 cursor-not-allowed">
            Voice scribe – not implemented
          </button>
        </div>
      </div>
    </div>
  );
};
