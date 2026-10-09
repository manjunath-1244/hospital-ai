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
import { ErrorBox, Loading, SuccessBox, fmtTime } from '../ui/common';
import { Alert, Button, Card, EmptyState, Field, SectionTitle, Select, Textarea, cx } from '../ui/kit';

const Pill: React.FC<{ cls: string; children: React.ReactNode }> = ({ cls, children }) => (
  <span className={cx('inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', cls)}>{children}</span>
);

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

  const formDisabled = !visitId || !visitOpen;

  return (
    <Card as="section" className="space-y-6" data-testid="referrals-panel">
      <div>
        <SectionTitle icon={<Send className="h-5 w-5" />} hint="Specialist referrals for this patient.">Referrals</SectionTitle>
        {!referrals && !error && <Loading text="Loading referrals..." />}
        <ErrorBox message={error} />
        {referrals && referrals.length === 0 && <EmptyState title="No referrals for this patient." hint="Use the review or the form below to refer to a specialist." />}
        <ul className="space-y-2">
          {referrals?.map((r) => (
            <li key={r.id} data-testid="referral-row" className="space-y-1 rounded-lg border border-line bg-surface-muted p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-ink">{r.specialty}</span>
                <Pill cls={URGENCY_BADGE[r.urgency]}>{r.urgency}</Pill>
                <Pill cls={REFERRAL_STATUS_BADGE[r.status]}>{REFERRAL_STATUS_LABEL[r.status]}</Pill>
                <span className="ml-auto text-xs text-ink-3">{r.id}</span>
              </div>
              <p className="text-sm text-ink">{r.reason}</p>
              <p className="text-sm text-ink-3">
                Specialist: {r.assignedSpecialistName ?? 'unassigned (any ' + r.specialty + ' specialist)'} • requested by {r.requestedByName} • {fmtTime(r.createdAt)} ({ageLabel(r.createdAt)} ago)
              </p>
              {r.cancellationReason && <p className="text-sm text-ink-3">Cancelled: {r.cancellationReason}</p>}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-base font-semibold text-ink">AI review for specialist referral</p>
          <Button variant="secondary" onClick={review} loading={recBusy} icon={<Sparkles className="h-4 w-4" />} data-testid="referral-review-button">
            {recBusy ? 'Reviewing...' : 'Review for specialist'}
          </Button>
        </div>
        <ErrorBox message={recError} />
        {rec && (
          <div className="space-y-2 text-sm text-ink">
            {rec.recommendation === 'NONE' && <Alert tone="success">No specialist referral recommended.</Alert>}
            {rec.recommendation === 'NEEDS_DOCTOR_REVIEW' && <Alert tone="warning">Needs doctor review: {rec.verification.reason ?? 'evidence could not be verified.'}</Alert>}
            {rec.recommendation === 'SPECIALIST' && (
              <Alert tone={rec.verification.verified ? 'info' : 'warning'}>
                Recommend {rec.specialty} ({rec.urgency}) - confidence {Math.round(rec.confidence * 100)}%{rec.verification.verified ? ', evidence verified' : ', evidence NOT verified'}
              </Alert>
            )}
            {rec.rationale.map((x, i) => <p key={i} className="text-ink-2">- {x}</p>)}
            {rec.evidence.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-ink-3">Evidence</p>
                {rec.evidence.map((x, i) => <p key={i} className="text-ink-2">{evidenceText(x)}</p>)}
              </div>
            )}
            {rec.missingInfo.length > 0 && <p className="text-warning-700">Missing information: {rec.missingInfo.join('; ')}</p>}
            {rec.recommendation === 'SPECIALIST' && (
              <Button onClick={useRecommendation}>Fill the referral form from this</Button>
            )}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4" data-testid="referral-form">
        <h3 className="text-base font-semibold text-ink">Refer to specialist</h3>
        {!visitId && <Alert tone="danger">This patient has no visit; a referral needs an open visit.</Alert>}
        {visitId && !visitOpen && <Alert tone="danger">The visit is closed; referrals are disabled.</Alert>}
        <fieldset disabled={formDisabled} className={cx('min-w-0 space-y-4', formDisabled && 'opacity-60')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Specialty *">
              {(id) => (
                <Select id={id} required value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value, specialistId: '' })}>
                  <option value="">Select specialty</option>
                  {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Specialist (optional)">
              {(id) => (
                <Select id={id} value={form.specialistId} onChange={(e) => setForm({ ...form, specialistId: e.target.value })} disabled={!form.specialty}>
                  <option value="">Any {form.specialty || 'specialist'}</option>
                  {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isAvailable ? '' : ' (unavailable)'}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Urgency">
              {(id) => (
                <Select id={id} value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value as ReferralUrgency })}>
                  {REFERRAL_URGENCIES.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Reason *">
            {(id) => <Textarea id={id} required rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
          </Field>
          {ai && <p className="text-sm text-info-700">AI rationale and evidence will be attached to this referral.</p>}
          <ErrorBox message={formError} />
          <SuccessBox message={formMsg} />
          <Button type="submit" className="w-full" loading={busy} disabled={!form.specialty || !form.reason.trim()} data-testid="referral-submit">
            {busy ? 'Sending...' : 'Refer to specialist'}
          </Button>
        </fieldset>
      </form>
    </Card>
  );
};
