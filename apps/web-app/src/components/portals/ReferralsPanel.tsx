'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import {
  REFERRAL_STATUS_BADGE,
  REFERRAL_STATUS_LABEL,
  REFERRAL_URGENCIES,
  URGENCY_BADGE,
  ageLabel,
  byReferralUrgency,
  evidenceText,
  type Referral,
  type ReferralRecommendation,
  type ReferralUrgency,
} from '../../lib/referrals';
import type { Specialist } from '../../lib/specialists';
import { Empty, ErrorBox, Loading, SuccessBox, fmtTime, inputCls, labelCls } from '../ui/common';

interface Props {
  patientId: string;
  /** The patient's latest visit id and whether it is open; referrals attach to an open visit. */
  visitId: string | null;
  visitOpen: boolean;
}

/** Doctor workbench: referrals of the selected patient, AI "review for specialist", and a manual referral form. */
export const ReferralsPanel: React.FC<Props> = ({ patientId, visitId, visitOpen }) => {
  const [referrals, setReferrals] = useState<Referral[] | null>(null);
  const [error, setError] = useState('');

  const [rec, setRec] = useState<ReferralRecommendation | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [recError, setRecError] = useState('');

  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [form, setForm] = useState({ specialty: '', specialistId: '', urgency: 'ROUTINE' as ReferralUrgency, reason: '' });
  const [ai, setAi] = useState<{ aiRationale: string; evidence: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [formMsg, setFormMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ referrals: Referral[] }>(`/hospital/referrals?patientId=${encodeURIComponent(patientId)}`);
      setReferrals([...r.referrals].sort(byReferralUrgency));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [patientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReferrals(null);
    setRec(null);
    setRecError('');
    setFormMsg('');
    setFormError('');
    setAi(null);
    load();
  }, [load]);
  useRealtime(['referral.created', 'referral.updated'], load);

  useEffect(() => {
    apiFetch<string[]>('/hospital/specialties').then(setSpecialties).catch((e) => setFormError(errorMessage(e)));
  }, []);

  useEffect(() => {
    if (!form.specialty) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSpecialists([]);
      return;
    }
    let cancelled = false;
    apiFetch<Specialist[]>(`/hospital/specialists?specialty=${encodeURIComponent(form.specialty)}`)
      .then((s) => !cancelled && setSpecialists(s))
      .catch(() => !cancelled && setSpecialists([]));
    return () => {
      cancelled = true;
    };
  }, [form.specialty]);

  const review = async () => {
    setRecBusy(true);
    setRecError('');
    setRec(null);
    try {
      setRec(await apiFetch<ReferralRecommendation>(`/hospital/patients/${encodeURIComponent(patientId)}/referral-recommendation`));
    } catch (e) {
      setRecError(errorMessage(e));
    } finally {
      setRecBusy(false);
    }
  };

  const useRecommendation = () => {
    if (!rec || rec.recommendation !== 'SPECIALIST') return;
    setForm({
      specialty: rec.specialty ?? '',
      specialistId: '',
      urgency: rec.urgency ?? 'ROUTINE',
      reason: rec.rationale[0] ?? '',
    });
    setAi({ aiRationale: rec.rationale.join('\n'), evidence: rec.evidence });
    setFormMsg('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitId) return;
    setBusy(true);
    setFormError('');
    setFormMsg('');
    try {
      const r = await apiFetch<{ success: boolean; referral: Referral }>('/hospital/referrals', {
        method: 'POST',
        body: {
          visitId,
          patientId,
          specialty: form.specialty,
          urgency: form.urgency,
          reason: form.reason.trim(),
          ...(form.specialistId ? { assignedSpecialistId: form.specialistId } : {}),
          ...(ai ? { aiRationale: ai.aiRationale, evidence: ai.evidence } : {}),
        },
      });
      setFormMsg(`Referral ${r.referral.id} created (${REFERRAL_STATUS_LABEL[r.referral.status]}).`);
      setForm({ specialty: '', specialistId: '', urgency: 'ROUTINE', reason: '' });
      setAi(null);
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-5">
      <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
        <Send className="h-5 w-5 text-indigo-400" /> Referrals
      </h3>
      {!referrals && !error && <Loading text="Loading referrals..." />}
      <ErrorBox message={error} />
      {referrals && referrals.length === 0 && <Empty text="No referrals for this patient." />}
      <div className="space-y-2">
        {referrals?.map((r) => (
          <div key={r.id} className="rounded-xl bg-slate-950 border border-slate-700 p-4 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold text-white">{r.specialty}</span>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${URGENCY_BADGE[r.urgency]}`}>{r.urgency}</span>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${REFERRAL_STATUS_BADGE[r.status]}`}>{REFERRAL_STATUS_LABEL[r.status]}</span>
              <span className="ml-auto font-mono text-sm text-slate-400">{r.id}</span>
            </div>
            <p className="text-base text-slate-200">{r.reason}</p>
            <p className="text-sm text-slate-400">
              Specialist: {r.assignedSpecialistName ?? 'unassigned (any ' + r.specialty + ' specialist)'} • requested by {r.requestedByName} • {fmtTime(r.createdAt)} ({ageLabel(r.createdAt)} ago)
            </p>
            {r.cancellationReason && <p className="text-sm text-slate-400">Cancelled: {r.cancellationReason}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-slate-950 border border-slate-700 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-base font-bold text-slate-200">AI review for specialist referral</p>
          <button onClick={review} disabled={recBusy} className="flex min-h-11 items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-600/20 px-4 text-base font-bold text-indigo-100 hover:bg-indigo-600/30 disabled:opacity-50">
            <Sparkles className="h-4 w-4" /> {recBusy ? 'Reviewing...' : 'Review for specialist'}
          </button>
        </div>
        <ErrorBox message={recError} />
        {rec && (
          <div className="space-y-2 text-base text-slate-200">
            {rec.recommendation === 'NONE' && <p className="font-bold text-emerald-300">No specialist referral recommended.</p>}
            {rec.recommendation === 'NEEDS_DOCTOR_REVIEW' && <p className="font-bold text-amber-300">Needs doctor review: {rec.verification.reason ?? 'evidence could not be verified.'}</p>}
            {rec.recommendation === 'SPECIALIST' && (
              <p className="font-bold text-indigo-200">
                Recommend {rec.specialty} ({rec.urgency}) - confidence {Math.round(rec.confidence * 100)}%{rec.verification.verified ? ', evidence verified' : ', evidence NOT verified'}
              </p>
            )}
            {rec.rationale.map((x, i) => <p key={i} className="text-sm text-slate-300">- {x}</p>)}
            {rec.evidence.length > 0 && (
              <div>
                <p className="text-sm font-bold text-slate-400 uppercase">Evidence</p>
                {rec.evidence.map((x, i) => <p key={i} className="text-sm text-slate-300 font-mono">{evidenceText(x)}</p>)}
              </div>
            )}
            {rec.missingInfo.length > 0 && <p className="text-sm text-amber-300">Missing information: {rec.missingInfo.join('; ')}</p>}
            {rec.recommendation === 'SPECIALIST' && (
              <button onClick={useRecommendation} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-base font-bold text-white hover:bg-indigo-500">Fill the referral form from this</button>
            )}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <p className="text-base font-bold text-slate-200">Refer to specialist</p>
        {!visitId && <p className="text-base font-semibold text-rose-400">This patient has no visit; a referral needs an open visit.</p>}
        {visitId && !visitOpen && <p className="text-base font-semibold text-rose-400">The visit is closed; referrals are disabled.</p>}
        <fieldset disabled={!visitId || !visitOpen} className={`space-y-3 min-w-0 ${!visitId || !visitOpen ? 'opacity-50' : ''}`}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Specialty *</label>
              <select required value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value, specialistId: '' })} className={inputCls}>
                <option value="">Select specialty</option>
                {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Specialist (optional)</label>
              <select value={form.specialistId} onChange={(e) => setForm({ ...form, specialistId: e.target.value })} className={inputCls} disabled={!form.specialty}>
                <option value="">Any {form.specialty || 'specialist'}</option>
                {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isAvailable ? '' : ' (unavailable)'}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Urgency</label>
              <select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value as ReferralUrgency })} className={inputCls}>
                {REFERRAL_URGENCIES.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Reason *</label>
            <textarea required rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls} />
          </div>
          {ai && <p className="text-sm text-indigo-300">AI rationale and evidence will be attached to this referral.</p>}
          <ErrorBox message={formError} />
          <SuccessBox message={formMsg} />
          <button type="submit" disabled={busy || !form.specialty || !form.reason.trim()} className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 py-3 text-base font-bold text-white disabled:opacity-50">
            {busy ? 'Sending...' : 'Refer to specialist'}
          </button>
        </fieldset>
      </form>
    </div>
  );
};
