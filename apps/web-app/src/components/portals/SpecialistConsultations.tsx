'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Inbox, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRealtime, useRole } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
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
import { ErrorBox, Loading, SuccessBox, fmtTime, splitList } from '../ui/common';
import { Alert, Button, Card, Detail, EmptyState, Field, Input, SectionTitle, Textarea, cx } from '../ui/kit';

const Pill: React.FC<{ cls: string; children: React.ReactNode }> = ({ cls, children }) => (
  <span className={cx('inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', cls)}>{children}</span>
);

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

const EMPTY_FORM = { assessment: '', recommendation: '', treatment: '', followUp: '' };

const List: React.FC<{ title: string; items?: string[] }> = ({ title, items }) => (
  <div className="rounded-lg border border-line bg-surface-muted p-3">
    <p className="mb-1 text-xs font-semibold uppercase text-ink-3">{title}</p>
    {items && items.length ? items.map((i, k) => <p key={k} className="text-sm text-ink">{i}</p>) : <p className="text-sm text-ink-3">None recorded</p>}
  </div>
);

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-lg border border-line bg-surface-muted p-3">
    <p className="mb-1 text-xs font-semibold uppercase text-ink-3">{title}</p>
    {children}
  </div>
);

export const SpecialistConsultations: React.FC = () => {
  const { user } = useAuth();
  const { ownRole, navTarget, clearNav } = useRole();
  const isAdmin = ownRole === 'ADMIN';
  const [referrals, setReferrals] = useState<Referral[] | null>(null);
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
  const nameOf = (r: Referral) => r.patientName ?? undefined;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-1" data-testid="consultations-inbox">
        <SectionTitle icon={<Inbox className="h-5 w-5" />} hint="Most urgent first.">My consultations</SectionTitle>
        {!referrals && !error && <Loading text="Loading consultations..." />}
        <ErrorBox message={error} />
        {referrals && referrals.length === 0 && !error && <EmptyState title="No consultation requests for you." hint="New referrals to you or your specialty queue appear here." />}
        <div className="max-h-[640px] space-y-2 overflow-y-auto">
          {referrals?.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              aria-pressed={selectedId === r.id}
              data-testid="consultation-row"
              className={cx(
                'min-h-11 w-full space-y-1 rounded-lg border p-4 text-left',
                selectedId === r.id ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:bg-surface-muted',
                !isOpenReferral(r) && 'opacity-70',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-ink">{nameOf(r) ?? r.patientId}</span>
                <Pill cls={URGENCY_BADGE[r.urgency]}>{r.urgency}</Pill>
              </div>
              <p className="text-xs text-ink-3">{r.patientId} • {r.id}</p>
              <p className="line-clamp-2 text-sm text-ink">{r.reason}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                <Pill cls={REFERRAL_STATUS_BADGE[r.status]}>{REFERRAL_STATUS_LABEL[r.status]}</Pill>
                <span>waiting {ageLabel(r.createdAt)}</span>
                <span>{r.assignedSpecialistId ? 'assigned to you' : `${r.specialty} queue`}</span>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-6 xl:col-span-2" data-testid="consultation-detail">
        {!selected && <Card><EmptyState title="Select a consultation to see the referral and patient chart." hint="Choose a request from the list on the left." /></Card>}
        {selected && <ConsultationDetail key={selected.id} referral={selected} patientName={nameOf(selected)} onChanged={load} />}
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
    <Field label={`${label} *`}>
      {(id) => <Textarea id={id} required rows={3} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}
    </Field>
  );

  return (
    <>
      <Card>
        <SectionTitle>Referral {referral.id}</SectionTitle>
        <dl className="space-y-1.5">
          <Detail label="Patient"><span className="font-semibold">{patientName ?? 'Unknown'}</span> <span className="text-xs text-ink-3">({referral.patientId})</span></Detail>
          <Detail label="Specialty">
            {referral.specialty} <span className="ml-2"><Pill cls={URGENCY_BADGE[referral.urgency]}>{referral.urgency}</Pill></span> <span className="ml-1"><Pill cls={REFERRAL_STATUS_BADGE[referral.status]}>{REFERRAL_STATUS_LABEL[referral.status]}</Pill></span>
          </Detail>
          <Detail label="Requested by">{referral.requestedByName} • {fmtTime(referral.createdAt)} ({ageLabel(referral.createdAt)} ago)</Detail>
          <Detail label="Reason">{referral.reason}</Detail>
          {referral.aiRationale && <Detail label="AI rationale"><span className="whitespace-pre-wrap">{referral.aiRationale}</span></Detail>}
        </dl>
      </Card>

      <Card>
        <SectionTitle>Patient chart summary</SectionTitle>
        {!chart && !chartError && <Loading text="Loading chart..." />}
        <ErrorBox message={chartError} />
        {chart && (
          <div className="space-y-3">
            <p className="text-sm text-ink">{chart.patient.name} • {chart.patient.age}y {chart.patient.gender} • blood type {chart.patient.bloodType}{chart.currentVisit ? ` • ${chart.currentVisit.statusLabel}${chart.currentVisit.chiefComplaint ? `: ${chart.currentVisit.chiefComplaint}` : ''}` : ''}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <List title="Conditions" items={chart.conditions} />
              <List title="Allergies" items={chart.allergies} />
              <List title="Current medications" items={chart.currentMedications} />
            </div>
            {chart.medicationSafetyAlerts && chart.medicationSafetyAlerts.length > 0 && (
              <Alert tone="warning" title="Medication safety alerts">
                {chart.medicationSafetyAlerts.map((a, i) => <p key={i}><span className="font-semibold">[{a.severity}] {a.drug}</span>: {a.message}</p>)}
              </Alert>
            )}
            {chart.labs && chart.labs.length > 0 && (
              <Panel title="Recent labs">
                {chart.labs.map((l, i) => (
                  <p key={i} className="text-sm text-ink">{l.test}: <span className="tabular-nums">{l.value} {l.unit}</span>{' '}
                    <span className={l.status === 'CRITICAL' ? 'font-semibold text-danger-700' : l.status === 'ABNORMAL' ? 'font-semibold text-warning-700' : 'text-success-700'}>{l.status}</span>
                  </p>
                ))}
              </Panel>
            )}
            {chart.recentVitals && chart.recentVitals.length > 0 && (
              <Panel title="Recent vitals">
                <div className="overflow-x-auto">
                  {chart.recentVitals.map((v, i) => (
                    <p key={i} className="whitespace-nowrap text-sm tabular-nums text-ink">{fmtTime(v.at)}: HR {v.heartRate} • SBP {v.bpSystolic} • SpO2 {v.spO2}% • T {v.tempC} • RR {v.respiratoryRate} • NEWS2 {v.news2} ({v.risk})</p>
                  ))}
                </div>
              </Panel>
            )}
            {chart.recentConsultations && chart.recentConsultations.length > 0 && (
              <Panel title="Recent consultations">
                {chart.recentConsultations.map((c, i) => <p key={i} className="text-sm text-ink">{fmtTime(c.at)} • {c.doctor}: <span className="font-semibold">{c.diagnosis}</span> {c.notes}</p>)}
              </Panel>
            )}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          actions={
            <Button onClick={loadAi} loading={aiBusy} icon={<Sparkles className="h-4 w-4" />} data-testid="ai-summary-button">
              {aiBusy ? 'Generating...' : ai ? 'Refresh summary' : 'Generate AI summary'}
            </Button>
          }
        >
          AI referral summary
        </SectionTitle>
        <ErrorBox message={aiError} />
        {!ai && !aiError && !aiBusy && <EmptyState title="No summary generated yet." hint="Generate a draft with cited evidence and guidelines for this referral." />}
        {ai && (
          <div className="space-y-3 text-sm text-ink">
            <Alert tone="warning">AI-generated draft - clinician review required. Generated {fmtTime(ai.generatedAt)}.</Alert>
            {ai.aiRationale && <p className="whitespace-pre-wrap">{ai.aiRationale}</p>}
            <div>
              <p className="text-xs font-semibold uppercase text-ink-3">Cited evidence</p>
              {ai.evidence && ai.evidence.length > 0 ? ai.evidence.map((x, i) => <p key={i} className="text-ink-2">- {evidenceText(x)}</p>) : <p className="text-ink-3">No evidence attached to this referral.</p>}
            </div>
            {ai.keyClinicalFindings.abnormalLabs && ai.keyClinicalFindings.abnormalLabs.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase text-ink-3">Abnormal labs</p>
                {ai.keyClinicalFindings.abnormalLabs.map((l, i) => <p key={i}>{l.test}: {l.value} {l.unit} ({l.status})</p>)}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase text-ink-3">Guidelines cited</p>
              {ai.guidelinesCited.length ? ai.guidelinesCited.map((g, i) => <p key={i}>- {g.title} <span className="text-ink-3">({g.filename})</span></p>) : <p className="text-ink-3">No matching guideline documents.</p>}
            </div>
          </div>
        )}
      </Card>

      <Card as="div">
        <form onSubmit={complete} className="space-y-4" data-testid="complete-consultation-form">
          <SectionTitle>Complete consultation</SectionTitle>
          {!open && <Alert tone="neutral">This referral is {REFERRAL_STATUS_LABEL[referral.status].toLowerCase()}; it can no longer be completed.</Alert>}
          <fieldset disabled={!open} className={cx('min-w-0 space-y-4', !open && 'opacity-60')}>
            {field('assessment', 'Assessment')}
            {field('recommendation', 'Recommendation')}
            {field('treatment', 'Treatment')}
            {field('followUp', 'Follow-up instructions')}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Follow-up tests (comma separated, one lab order each)" className="sm:col-span-2">
                {(id) => <Input id={id} value={tests} onChange={(e) => setTests(e.target.value)} placeholder="e.g. Troponin T, Lipid panel" />}
              </Field>
              <Field label="Follow-up in (days)">
                {(id) => <Input id={id} type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />}
              </Field>
            </div>
            <ErrorBox message={formError} />
            <SuccessBox message={msg} />
            <Button type="submit" className="w-full" loading={busy} data-testid="complete-consultation-submit">
              {busy ? 'Submitting...' : 'Complete consultation'}
            </Button>
          </fieldset>
        </form>
      </Card>
    </>
  );
};
