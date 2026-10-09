'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Stethoscope, Activity, Search, FlaskConical, Pill, ImageIcon, FileText, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRealtime, useRole } from '../../context/RoleContext';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import type {
  ConsultationResponse,
  ImagingStudy,
  LabResult,
  MedicationsResponse,
  Patient,
  PatientList,
  Safety,
  Vitals,
} from '../../lib/types';
import type { VisitSummary } from '../../lib/visits';
import { byUrgency, isActiveStatus, STAGE_TABS, type PatientStage } from '../../lib/visits';
import { Empty, ErrorBox, Loading, PriorityBadge, SafetyPanel, StatusBadge, SuccessBox, fmtTime, fmtWait, splitList } from '../ui/common';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, SectionTitle, TableFrame, Tabs, Textarea, cx, type Tone } from '../ui/kit';
import { PendingActionsPanel } from './PendingActionsPanel';
import { ReferralsPanel } from './ReferralsPanel';
import { FollowUpPanel } from './FollowUpPanel';
import { LabResultForm } from '../ui/LabResultForm';
import { AppointmentBooking } from '../ui/AppointmentBooking';
import { VisitHistory, VisitPanel } from '../ui/VisitPanel';

interface Emr {
  patient: Patient;
  labs: LabResult[];
  meds: MedicationsResponse;
  vitals: Vitals[];
  imaging: ImagingStudy[];
  visits: VisitSummary[];
}

export const DoctorWorkbenchPortal: React.FC = () => {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<PatientStage>('ACTIVE');
  const [list, setList] = useState<Patient[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [emr, setEmr] = useState<Emr | null>(null);
  const [emrLoading, setEmrLoading] = useState(false);
  const [emrError, setEmrError] = useState('');

  const [diagnosis, setDiagnosis] = useState('');
  const [prescriptions, setPrescriptions] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<ConsultationResponse | null>(null);
  const [blockSafety, setBlockSafety] = useState<Safety | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const loadList = useCallback(async () => {
    try {
      const r = await apiFetch<PatientList>(`/hospital/patients?limit=50&stage=${stage}&q=${encodeURIComponent(q)}`);
      // Patients waiting for the doctor (TRIAGED) first, then by priority and wait.
      setList([...r.items].sort((a, b) => Number(b.visit?.status === 'TRIAGED') - Number(a.visit?.status === 'TRIAGED') || byUrgency(a.visit ?? null, b.visit ?? null)));
      setListError('');
    } catch (e) {
      setListError(errorMessage(e));
    } finally {
      setListLoading(false);
    }
  }, [q, stage]);

  useEffect(() => {
    const t = setTimeout(loadList, 250);
    return () => clearTimeout(t);
  }, [loadList]);

  const loadEmr = useCallback(async (id: string, silent = false) => {
    if (!silent) setEmrLoading(true);
    setEmrError('');
    try {
      const base = `/hospital/patients/${encodeURIComponent(id)}`;
      const [patient, labs, meds, vitals, imaging, visits] = await Promise.all([
        apiFetch<Patient>(base),
        apiFetch<LabResult[]>(`${base}/labs`),
        apiFetch<MedicationsResponse>(`${base}/medications`),
        apiFetch<Vitals[]>(`${base}/vitals`),
        apiFetch<ImagingStudy[]>(`${base}/imaging`),
        apiFetch<VisitSummary[]>(`${base}/visits`),
      ]);
      setEmr({ patient, labs, meds, vitals, imaging, visits });
    } catch (e) {
      setEmr(null);
      setEmrError(errorMessage(e));
    } finally {
      setEmrLoading(false);
    }
  }, []);

  useRealtime(['patient.registered', 'doctor.consulted', 'visit.updated', 'patient.deleted'], () => {
    loadList();
    if (selectedId) loadEmr(selectedId, true);
  });

  const select = (id: string) => {
    setSelectedId(id);
    setResult(null);
    setBlockSafety(null);
    setOverrideReason('');
    setSubmitError('');
    loadEmr(id);
  };

  const { navTarget, clearNav } = useRole();
  useEffect(() => {
    // A notification asked to open a patient: select them (the effect consumes the request once).
    if (!navTarget?.patientId) return;
    const id = navTarget.patientId;
    clearNav();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    select(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navTarget]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    setSubmitting(true);
    setSubmitError('');
    setResult(null);
    try {
      const res = await apiFetch<ConsultationResponse>('/hospital/lifecycle/record-consultation', {
        method: 'POST',
        body: {
          patientId: selectedId,
          doctorName: user?.displayName,
          diagnosis: diagnosis.trim(),
          prescriptions: splitList(prescriptions),
          notes: notes.trim(),
          ...(blockSafety && overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
        },
      });
      setResult(res);
      setBlockSafety(null);
      setOverrideReason('');
      setDiagnosis('');
      setPrescriptions('');
      setNotes('');
      loadEmr(selectedId, true);
      loadList();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.body as { safety?: Safety })?.safety) {
        setBlockSafety((err.body as { safety: Safety }).safety);
        setSubmitError(err.message);
      } else {
        setSubmitError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const p = emr?.patient;
  const visit = p?.visit ?? null;
  const closed = !isActiveStatus(visit?.status);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Stethoscope className="h-6 w-6" />}
        title="Physician EMR Workbench"
        subtitle="Review a patient record and record a consultation. Prescriptions are checked by the backend medication safety audit."
      />

      <PendingActionsPanel />

      <AppointmentBooking collapsible />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Patient list */}
        <Card className="space-y-3 lg:col-span-1">
          <SectionTitle icon={<Search className="h-5 w-5" />} className="mb-1">Patients</SectionTitle>
          <Field label="Search patients">
            {(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID" />}
          </Field>
          <Tabs label="Patient stage" tabs={STAGE_TABS.map((t) => ({ id: t.id, label: t.label }))} value={stage} onChange={(id) => setStage(id as PatientStage)} />
          {listLoading && <Loading text="Loading patients..." />}
          <ErrorBox message={listError} />
          {!listLoading && !listError && list.length === 0 && <Empty text="No patients found." />}
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {list.map((pt) => (
              <button
                key={pt.id}
                type="button"
                data-testid="patient-list-item"
                aria-pressed={selectedId === pt.id}
                onClick={() => select(pt.id)}
                className={cx(
                  'w-full rounded-lg border p-3 text-left text-sm',
                  selectedId === pt.id ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:bg-surface-muted',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-ink">{pt.name}</p>
                  <PriorityBadge priority={pt.visit?.priority} />
                </div>
                <p className="text-ink-3">
                  {pt.id} • {pt.age}y {pt.gender}{pt.visit?.waitMinutes != null ? ` • waiting ${fmtWait(pt.visit.waitMinutes)}` : ''}
                </p>
                <p className="truncate text-ink-2">{pt.visit?.chiefComplaint || '—'}</p>
                <div className="mt-1"><StatusBadge visit={pt.visit} /></div>
              </button>
            ))}
          </div>
        </Card>

        {/* EMR + consultation */}
        <div className="space-y-6 lg:col-span-2">
          {!selectedId && !emrLoading && <Card as="div"><Empty text="Select a patient to open their record." /></Card>}
          {emrLoading && <Card as="div"><Loading text="Loading record..." /></Card>}
          <ErrorBox message={emrError} />

          {p && emr && !emrLoading && (
            <>
              <Card as="div" data-testid="clinical-summary" className="space-y-4 text-sm">
                <SectionTitle
                  icon={<Activity className="h-5 w-5" />}
                  className="mb-0"
                  actions={
                    <>
                      <span className="font-mono text-sm font-semibold text-brand-700">{p.id}</span>
                      <StatusBadge visit={visit} />
                    </>
                  }
                >
                  Clinical Summary
                </SectionTitle>
                {visit ? (
                  <VisitPanel visitId={visit.id} onChanged={() => { loadEmr(p.id, true); loadList(); }} />
                ) : (
                  <Alert tone="danger">
                    <span className="flex items-start gap-2 font-semibold"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> This patient has no visit. The front desk must start a visit before clinical entries.</span>
                  </Alert>
                )}
                {visit && closed && (
                  <Alert tone="danger">
                    <span className="flex items-start gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> This visit is {visit.statusLabel.toLowerCase()}{visit.closeReason ? ` — ${visit.closeReason}` : ''}. Reopen it (if allowed) to record new clinical entries.</span>
                  </Alert>
                )}
                <div className="rounded-lg border border-line bg-surface-muted p-3">
                  <p className="text-sm font-semibold text-ink">{p.name}</p>
                  <p className="text-sm text-ink-3">
                    {p.age} yrs • {p.gender} • Blood type {p.bloodType} • DOB {p.dob} • {p.phone}
                  </p>
                </div>
                <Section title="Visit history" icon={<Activity className="h-4 w-4" />}>
                  <VisitHistory visits={emr.visits} />
                </Section>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <ListBox title="Allergies" items={emr.meds.allergies} tone="danger" />
                  <ListBox title="Current medications" items={emr.meds.medications} tone="neutral" icon={<Pill className="h-4 w-4" />} />
                  <ListBox title="Conditions" items={p.conditions} tone="warning" />
                </div>

                <Section title="Latest vitals" icon={<Activity className="h-4 w-4" />}>
                  {emr.vitals.length === 0 ? (
                    <Empty text="No vitals recorded." />
                  ) : (
                    <TableFrame>
                      <table className="w-full text-left">
                        <thead>
                          <tr><th scope="col">When</th><th scope="col">HR</th><th scope="col">SBP</th><th scope="col">SpO2</th><th scope="col">Temp</th><th scope="col">RR</th><th scope="col">NEWS2</th></tr>
                        </thead>
                        <tbody className="font-mono">
                          {emr.vitals.slice(0, 5).map((v) => (
                            <tr key={v.id}>
                              <td>{fmtTime(v.recordedAt)}</td><td>{v.heartRate}</td><td>{v.bpSystolic}</td><td>{v.spO2}</td><td>{v.tempCelsius}</td><td>{v.respiratoryRate}</td>
                              <td>{v.news2Score} ({v.riskLevel})</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableFrame>
                  )}
                </Section>

                <Section title="Lab results" icon={<FlaskConical className="h-4 w-4" />}>
                  {emr.labs.length === 0 ? (
                    <Empty text="No lab results." />
                  ) : (
                    <TableFrame>
                      <table className="w-full text-left">
                        <thead><tr><th scope="col">Test</th><th scope="col">Value</th><th scope="col">Reference</th><th scope="col">Status</th><th scope="col">Date</th></tr></thead>
                        <tbody>
                          {emr.labs.map((l) => (
                            <tr key={l.id}>
                              <td>{l.testName}</td>
                              <td className="font-mono">{l.value} {l.unit}</td>
                              <td className="text-ink-3">{l.referenceRange}</td>
                              <td><Badge tone={l.status === 'CRITICAL' ? 'danger' : l.status === 'ABNORMAL' ? 'warning' : 'success'}>{l.status}</Badge></td>
                              <td className="text-ink-3">{fmtTime(l.date)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableFrame>
                  )}
                  <div className="mt-3">
                    <LabResultForm patientId={p.id} open={!closed} onSaved={() => loadEmr(p.id, true)} />
                  </div>
                </Section>

                <Section title="Imaging studies" icon={<ImageIcon className="h-4 w-4" />}>
                  {emr.imaging.length === 0 ? (
                    <Empty text="No imaging studies." />
                  ) : (
                    <ul className="space-y-1 text-ink">
                      {emr.imaging.map((s) => (
                        <li key={s.id}>
                          <span className="font-semibold">{s.modality}</span> — {s.description} ({fmtTime(s.studyDate ?? s.createdAt)})
                          {s.impression ? <span className="text-ink-3"> • Impression: {s.impression}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </Card>

              <Card as="div">
                <form onSubmit={submit}>
                  <fieldset disabled={closed} className={cx('min-w-0 space-y-4', closed && 'opacity-50')}>
                    <SectionTitle icon={<FileText className="h-5 w-5" />} className="mb-0">Record Consultation</SectionTitle>
                    <Field label="Diagnosis *">
                      {(id) => <Input id={id} required value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />}
                    </Field>
                    <Field label="Prescriptions (comma or line separated)">
                      {(id) => <Textarea id={id} rows={2} value={prescriptions} onChange={(e) => setPrescriptions(e.target.value)} placeholder="e.g. Amoxicillin 500mg TID, Paracetamol 500mg PRN" />}
                    </Field>
                    <Field label="Clinical notes *">
                      {(id) => <Textarea id={id} required rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
                    </Field>

                    {blockSafety && (
                      <div className="space-y-3">
                        <SafetyPanel safety={blockSafety} />
                        <Field label="Override reason (required to submit despite CRITICAL_BLOCK; recorded in the audit trail)">
                          {(id) => <Input id={id} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />}
                        </Field>
                      </div>
                    )}
                    <ErrorBox message={submitError} />

                    <Button
                      type="submit"
                      loading={submitting}
                      disabled={closed || submitting || (!!blockSafety && !overrideReason.trim())}
                      className="w-full"
                      data-testid="consultation-submit"
                    >
                      {submitting ? 'Submitting...' : blockSafety ? 'Submit with override' : 'Record consultation'}
                    </Button>

                    {result && (
                      <div className="space-y-3">
                        <SuccessBox message={`Consultation ${result.consultationId} recorded for ${result.patientName}.`} />
                        <SafetyPanel safety={result.safety} />
                      </div>
                    )}
                  </fieldset>
                </form>
              </Card>

              <ReferralsPanel patientId={p.id} visitId={visit?.id ?? null} visitOpen={!closed} />
              {visit && <FollowUpPanel visitId={visit.id} visitOpen={!closed} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const LISTBOX_TONE: Record<string, string> = {
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
  warning: 'border-warning-200 bg-warning-50 text-warning-700',
  neutral: 'border-line bg-surface text-ink',
};

const ListBox: React.FC<{ title: string; items: string[]; tone: Tone; icon?: React.ReactNode }> = ({ title, items, tone, icon }) => (
  <div className={cx('rounded-lg border p-3', LISTBOX_TONE[tone])}>
    <p className="mb-1 flex items-center gap-1 text-sm font-semibold">{icon}{title}</p>
    {items.length === 0 ? <p className="text-ink-3">None recorded</p> : items.map((i, idx) => <p key={idx}>{i}</p>)}
  </div>
);

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="rounded-lg border border-line bg-surface p-3">
    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink-2"><span className="text-ink-3" aria-hidden>{icon}</span>{title}</h3>
    {children}
  </div>
);
