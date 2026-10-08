'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Inbox, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRealtime, useRole } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import { resolvePatientNames, type PatientRef } from '../../lib/patients';
import {
  REFERRAL_STATUS_BADGE,
  REFERRAL_STATUS_LABEL,
  URGENCY_BADGE,
  ageLabel,
  byReferralUrgency,
  evidenceText,
  isOpenReferral,
  type AiReferralSummary,
  type CompleteConsultationPayload,
  type Referral,
} from '../../lib/referrals';
import { Empty, ErrorBox, Loading, SuccessBox, fmtTime, inputCls, labelCls, splitList } from '../ui/common';

/** Shape of GET /hospital/patients/:id/summary as returned for a SPECIALIST (subset used here). */
interface ChartSummary {
  patient: { id: string; name: string; age: number; gender: string; bloodType: string };
  currentVisit?: { statusLabel: string; chiefComplaint: string | null } | null;
  conditions?: string[];
  allergies?: string[];
  currentMedications?: string[];
  labs?: { test: string; value: string | number; unit: string; status: string; date: string }[];
  medicationSafetyAlerts?: { severity: string; drug: string; message: string }[];
  recentVitals?: { at: string; heartRate: number; bpSystolic: number; spO2: number; tempC: number; respiratoryRate: number; news2: number; risk: string }[];
  recentConsultations?: { at: string; doctor: string; diagnosis: string; notes: string }[];
}

const card = 'glass-panel p-7 rounded-2xl border border-slate-700 space-y-4';
const h3 = 'text-xl font-semibold text-white tracking-tight border-b border-slate-700 pb-4';
const EMPTY_FORM = { assessment: '', recommendation: '', treatment: '', followUp: '' };

const List: React.FC<{ title: string; items?: string[] }> = ({ title, items }) => (
  <div className="rounded-xl bg-slate-950 border border-slate-700 p-3">
    <p className="text-sm font-bold uppercase text-slate-400 mb-1">{title}</p>
    {items && items.length ? items.map((i, k) => <p key={k} className="text-base text-slate-200">{i}</p>) : <p className="text-base text-slate-500">None recorded</p>}
  </div>
);

export const SpecialistConsultations: React.FC = () => {
  const { user } = useAuth();
  const { ownRole, navTarget, clearNav } = useRole();
  const isAdmin = ownRole === 'ADMIN';
  const [referrals, setReferrals] = useState<Referral[] | null>(null);
  const [names, setNames] = useState<Map<string, PatientRef>>(new Map());
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const path = isAdmin ? '/hospital/referrals' : '/hospital/referrals/mine';
      const list = (await apiFetch<{ referrals: Referral[] }>(path)).referrals;
      list.sort(byReferralUrgency);
      setReferrals(list);
      setError('');
      setNames(await resolvePatientNames(list.map((r) => r.patientId)));
    } catch (e) {
      setError(errorMessage(e));
      setReferrals((p) => p ?? []);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  useRealtime(['referral.created', 'referral.updated'], load);

  useEffect(() => {
    if (!navTarget?.referralId || !referrals) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(navTarget.referralId);
    clearNav();
  }, [navTarget, referrals, clearNav]);

  const selected = referrals?.find((r) => r.id === selectedId) ?? null;
  const nameOf = (id: string) => names.get(id)?.name;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className={`${card} xl:col-span-1`}>
        <h3 className={`${h3} flex items-center gap-2`}><Inbox className="h-5 w-5 text-teal-400" /> My consultations</h3>
        {!referrals && !error && <Loading text="Loading consultations..." />}
        <ErrorBox message={error} />
        {referrals && referrals.length === 0 && !error && <Empty text="No consultation requests for you." />}
        <div className="max-h-[640px] overflow-y-auto space-y-2">
          {referrals?.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`w-full text-left rounded-xl border p-4 space-y-1 ${selectedId === r.id ? 'bg-teal-600/20 border-teal-400' : 'bg-slate-950 border-slate-800 hover:border-slate-600'} ${isOpenReferral(r) ? '' : 'opacity-60'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold text-white">{nameOf(r.patientId) ?? r.patientId}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${URGENCY_BADGE[r.urgency]}`}>{r.urgency}</span>
              </div>
              <p className="text-sm font-mono text-slate-400">{r.patientId} • {r.id}</p>
              <p className="text-base text-slate-200 line-clamp-2">{r.reason}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${REFERRAL_STATUS_BADGE[r.status]}`}>{REFERRAL_STATUS_LABEL[r.status]}</span>
                <span>waiting {ageLabel(r.createdAt)}</span>
                <span>{r.assignedSpecialistId ? 'assigned to you' : `${r.specialty} queue`}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="xl:col-span-2 space-y-6">
        {!selected && <div className={card}><Empty text="Select a consultation to see the referral and patient chart." /></div>}
        {selected && <ConsultationDetail key={selected.id} referral={selected} patientName={nameOf(selected.patientId)} onChanged={load} />}
      </div>
    </div>
  );
};

const ConsultationDetail: React.FC<{ referral: Referral; patientName?: string; onChanged: () => void }> = ({ referral, patientName, onChanged }) => {
  const [chart, setChart] = useState<ChartSummary | null>(null);
  const [chartError, setChartError] = useState('');
  const [ai, setAi] = useState<AiReferralSummary | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [tests, setTests] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch<ChartSummary>(`/hospital/patients/${encodeURIComponent(referral.patientId)}/summary`)
      .then((c) => !cancelled && setChart(c))
      .catch((e) => !cancelled && setChartError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [referral.patientId]);

  const loadAi = async () => {
    setAiBusy(true);
    setAiError('');
    try {
      const r = await apiFetch<{ summary: AiReferralSummary }>(`/hospital/referrals/${encodeURIComponent(referral.id)}/ai-summary`);
      setAi(r.summary);
    } catch (e) {
      setAiError(errorMessage(e));
    } finally {
      setAiBusy(false);
    }
  };

  const complete = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    setMsg('');
    try {
      const body: CompleteConsultationPayload = {
        assessment: form.assessment.trim(),
        recommendation: form.recommendation.trim(),
        treatment: form.treatment.trim(),
        followUp: form.followUp.trim(),
        ...(splitList(tests).length ? { followUpTests: splitList(tests) } : {}),
        ...(days.trim() && Number(days) > 0 ? { followUpDays: Number(days) } : {}),
      };
      await apiFetch(`/hospital/referrals/${encodeURIComponent(referral.id)}/complete`, { method: 'POST', body });
      setMsg('Consultation completed; the referring doctor has been notified.');
      setForm(EMPTY_FORM);
      setTests('');
      setDays('');
      onChanged();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const open = isOpenReferral(referral);
  const field = (k: keyof typeof EMPTY_FORM, label: string) => (
    <div>
      <label className={labelCls}>{label} *</label>
      <textarea required rows={3} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={inputCls} />
    </div>
  );

  return (
    <>
      <div className={card}>
        <h3 className={h3}>Referral {referral.id}</h3>
        <div className="space-y-1 text-base text-slate-200">
          <p><span className="text-slate-400">Patient:</span> <span className="font-bold text-white">{patientName ?? 'Unknown'}</span> <span className="font-mono text-sm text-slate-400">({referral.patientId})</span></p>
          <p><span className="text-slate-400">Specialty:</span> {referral.specialty} <span className={`ml-2 rounded-full border px-2.5 py-0.5 text-xs font-bold ${URGENCY_BADGE[referral.urgency]}`}>{referral.urgency}</span> <span className={`ml-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${REFERRAL_STATUS_BADGE[referral.status]}`}>{REFERRAL_STATUS_LABEL[referral.status]}</span></p>
          <p><span className="text-slate-400">Requested by:</span> {referral.requestedByName} • {fmtTime(referral.createdAt)} ({ageLabel(referral.createdAt)} ago)</p>
          <p><span className="text-slate-400">Reason:</span> {referral.reason}</p>
          {referral.aiRationale && <p className="whitespace-pre-wrap text-slate-300"><span className="text-slate-400">AI rationale:</span> {referral.aiRationale}</p>}
        </div>
      </div>

      <div className={card}>
        <h3 className={h3}>Patient chart summary</h3>
        {!chart && !chartError && <Loading text="Loading chart..." />}
        <ErrorBox message={chartError} />
        {chart && (
          <div className="space-y-3">
            <p className="text-base text-slate-200">{chart.patient.name} • {chart.patient.age}y {chart.patient.gender} • blood type {chart.patient.bloodType}{chart.currentVisit ? ` • ${chart.currentVisit.statusLabel}${chart.currentVisit.chiefComplaint ? `: ${chart.currentVisit.chiefComplaint}` : ''}` : ''}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <List title="Conditions" items={chart.conditions} />
              <List title="Allergies" items={chart.allergies} />
              <List title="Current medications" items={chart.currentMedications} />
            </div>
            {chart.medicationSafetyAlerts && chart.medicationSafetyAlerts.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-base text-amber-200">
                {chart.medicationSafetyAlerts.map((a, i) => <p key={i}><span className="font-bold">[{a.severity}] {a.drug}</span>: {a.message}</p>)}
              </div>
            )}
            {chart.labs && chart.labs.length > 0 && (
              <div className="rounded-xl bg-slate-950 border border-slate-700 p-3 overflow-x-auto">
                <p className="text-sm font-bold uppercase text-slate-400 mb-1">Recent labs</p>
                {chart.labs.map((l, i) => (
                  <p key={i} className="text-base text-slate-200">{l.test}: <span className="font-mono">{l.value} {l.unit}</span> <span className={l.status === 'CRITICAL' ? 'font-bold text-rose-400' : l.status === 'ABNORMAL' ? 'text-amber-400' : 'text-emerald-400'}>{l.status}</span></p>
                ))}
              </div>
            )}
            {chart.recentVitals && chart.recentVitals.length > 0 && (
              <div className="rounded-xl bg-slate-950 border border-slate-700 p-3 overflow-x-auto">
                <p className="text-sm font-bold uppercase text-slate-400 mb-1">Recent vitals</p>
                {chart.recentVitals.map((v, i) => (
                  <p key={i} className="text-base font-mono text-slate-200">{fmtTime(v.at)}: HR {v.heartRate} • SBP {v.bpSystolic} • SpO2 {v.spO2}% • T {v.tempC} • RR {v.respiratoryRate} • NEWS2 {v.news2} ({v.risk})</p>
                ))}
              </div>
            )}
            {chart.recentConsultations && chart.recentConsultations.length > 0 && (
              <div className="rounded-xl bg-slate-950 border border-slate-700 p-3">
                <p className="text-sm font-bold uppercase text-slate-400 mb-1">Recent consultations</p>
                {chart.recentConsultations.map((c, i) => <p key={i} className="text-base text-slate-200">{fmtTime(c.at)} • {c.doctor}: <span className="font-bold">{c.diagnosis}</span> {c.notes}</p>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-4">
          <h3 className="text-xl font-semibold text-white tracking-tight">AI referral summary</h3>
          <button onClick={loadAi} disabled={aiBusy} className="flex min-h-11 items-center gap-2 rounded-xl bg-teal-600 px-4 text-base font-bold text-white hover:bg-teal-500 disabled:opacity-50">
            <Sparkles className="h-4 w-4" /> {aiBusy ? 'Generating...' : ai ? 'Refresh summary' : 'Generate AI summary'}
          </button>
        </div>
        <ErrorBox message={aiError} />
        {ai && (
          <div className="space-y-3 text-base text-slate-200">
            <p className="text-sm font-semibold text-amber-200">AI-generated draft - clinician review required. Generated {fmtTime(ai.generatedAt)}.</p>
            {ai.aiRationale && <p className="whitespace-pre-wrap">{ai.aiRationale}</p>}
            <div>
              <p className="text-sm font-bold uppercase text-slate-400">Cited evidence</p>
              {ai.evidence && ai.evidence.length > 0 ? ai.evidence.map((x, i) => <p key={i} className="font-mono text-sm text-slate-300">- {evidenceText(x)}</p>) : <p className="text-slate-500">No evidence attached to this referral.</p>}
            </div>
            {ai.keyClinicalFindings.abnormalLabs && ai.keyClinicalFindings.abnormalLabs.length > 0 && (
              <div>
                <p className="text-sm font-bold uppercase text-slate-400">Abnormal labs</p>
                {ai.keyClinicalFindings.abnormalLabs.map((l, i) => <p key={i} className="font-mono text-sm">{l.test}: {l.value} {l.unit} ({l.status})</p>)}
              </div>
            )}
            <div>
              <p className="text-sm font-bold uppercase text-slate-400">Guidelines cited</p>
              {ai.guidelinesCited.length ? ai.guidelinesCited.map((g, i) => <p key={i} className="text-sm">- {g.title} <span className="font-mono text-slate-400">({g.filename})</span></p>) : <p className="text-slate-500">No matching guideline documents.</p>}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={complete} className={card}>
        <h3 className={h3}>Complete consultation</h3>
        {!open && <p className="text-base font-semibold text-slate-400">This referral is {REFERRAL_STATUS_LABEL[referral.status].toLowerCase()}; it can no longer be completed.</p>}
        <fieldset disabled={!open} className={`space-y-4 min-w-0 ${open ? '' : 'opacity-50'}`}>
          {field('assessment', 'Assessment')}
          {field('recommendation', 'Recommendation')}
          {field('treatment', 'Treatment')}
          {field('followUp', 'Follow-up instructions')}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className={labelCls}>Follow-up tests (comma separated, one lab order each)</label>
              <input value={tests} onChange={(e) => setTests(e.target.value)} className={inputCls} placeholder="e.g. Troponin T, Lipid panel" />
            </div>
            <div>
              <label className={labelCls}>Follow-up in (days)</label>
              <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className={inputCls} />
            </div>
          </div>
          <ErrorBox message={formError} />
          <SuccessBox message={msg} />
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-teal-600 py-3 text-base font-bold text-white hover:bg-teal-500 disabled:opacity-50">
            {busy ? 'Submitting...' : 'Complete consultation'}
          </button>
        </fieldset>
      </form>
    </>
  );
};

