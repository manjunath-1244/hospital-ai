'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Stethoscope, Activity, Search, FlaskConical, Pill, ImageIcon, FileText, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRealtime } from '../../context/RoleContext';
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
import { Empty, ErrorBox, Loading, PriorityBadge, SafetyPanel, StatusBadge, SuccessBox, fmtTime, fmtWait, inputCls, labelCls, splitList } from '../ui/common';
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
      <div className="rounded-2xl glass-panel p-7 border-l-4 border-l-indigo-500">
        <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <Stethoscope className="h-8 w-8 text-indigo-400" />
          Physician EMR Workbench
        </h2>
        <p className="text-base text-slate-300 mt-1.5">Review a patient record and record a consultation. Prescriptions are checked by the backend medication safety audit.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Patient list */}
        <div className="lg:col-span-1 glass-panel p-7 rounded-2xl border border-slate-700 space-y-3">
          <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
            <Search className="h-5 w-5 text-indigo-400" /> Patients
          </h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID" className={inputCls} />
          <div className="flex flex-wrap gap-1.5">
            {STAGE_TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setStage(t.id)} className={`rounded-lg px-3 py-1.5 text-sm font-bold border ${stage === t.id ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white'}`}>
                {t.label}
              </button>
            ))}
          </div>
          {listLoading && <Loading text="Loading patients..." />}
          <ErrorBox message={listError} />
          {!listLoading && !listError && list.length === 0 && <Empty text="No patients found." />}
          <div className="max-h-[420px] overflow-y-auto space-y-2">
            {list.map((pt) => (
              <button
                key={pt.id}
                onClick={() => select(pt.id)}
                className={`w-full text-left rounded-xl border p-3 text-sm transition-all ${
                  selectedId === pt.id ? 'bg-indigo-600/20 border-indigo-400' : 'bg-slate-950 border-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-white">{pt.name}</p>
                  <PriorityBadge priority={pt.visit?.priority} />
                </div>
                <p className="text-sm text-slate-400">
                  {pt.id} • {pt.age}y {pt.gender}{pt.visit?.waitMinutes != null ? ` • waiting ${fmtWait(pt.visit.waitMinutes)}` : ''}
                </p>
                <p className="text-sm text-slate-300 truncate">{pt.visit?.chiefComplaint || '—'}</p>
                <div className="mt-1"><StatusBadge visit={pt.visit} /></div>
              </button>
            ))}
          </div>
        </div>

        {/* EMR + consultation */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedId && <div className="glass-panel p-7 rounded-2xl border border-slate-700"><Empty text="Select a patient to open their record." /></div>}
          {emrLoading && <div className="glass-panel p-7 rounded-2xl border border-slate-700"><Loading text="Loading record..." /></div>}
          <ErrorBox message={emrError} />

          {p && emr && !emrLoading && (
            <>
              <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4 text-sm">
                <div className="flex items-center justify-between border-b border-slate-700 pb-4">
                  <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
                    <Activity className="h-5 w-5 text-indigo-400" /> Clinical Summary
                  </h3>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-indigo-400">{p.id}</span>
                    <StatusBadge visit={visit} />
                  </div>
                </div>
                {visit ? (
                  <VisitPanel visitId={visit.id} onChanged={() => { loadEmr(p.id, true); loadList(); }} />
                ) : (
                  <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/40 p-3 font-semibold text-rose-300">
                    <Lock className="h-4 w-4 shrink-0 mt-0.5" /> This patient has no visit. The front desk must start a visit before clinical entries.
                  </div>
                )}
                {visit && closed && (
                  <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 border border-rose-500/40 p-3 font-semibold text-rose-300">
                    <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                    <p className="text-sm font-normal">This visit is {visit.statusLabel.toLowerCase()}{visit.closeReason ? ` — ${visit.closeReason}` : ''}. Reopen it (if allowed) to record new clinical entries.</p>
                  </div>
                )}
                <div className="rounded-xl bg-slate-950 p-3 border border-slate-700">
                  <p className="font-bold text-white text-sm">{p.name}</p>
                  <p className="text-slate-400 text-sm">
                    {p.age} yrs • {p.gender} • Blood type {p.bloodType} • DOB {p.dob} • {p.phone}
                  </p>
                </div>
                <Section title="Visit history" icon={<Activity className="h-4 w-4" />}>
                  <VisitHistory visits={emr.visits} />
                </Section>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <ListBox title="Allergies" items={emr.meds.allergies} tone="rose" />
                  <ListBox title="Current medications" items={emr.meds.medications} tone="indigo" icon={<Pill className="h-4 w-4" />} />
                  <ListBox title="Conditions" items={p.conditions} tone="amber" />
                </div>

                <Section title="Latest vitals" icon={<Activity className="h-4 w-4" />}>
                  {emr.vitals.length === 0 ? (
                    <Empty text="No vitals recorded." />
                  ) : (
                    <table className="w-full text-left">
                      <thead className="text-slate-400">
                        <tr><th>When</th><th>HR</th><th>SBP</th><th>SpO2</th><th>Temp</th><th>RR</th><th>NEWS2</th></tr>
                      </thead>
                      <tbody className="font-mono text-slate-200">
                        {emr.vitals.slice(0, 5).map((v) => (
                          <tr key={v.id}>
                            <td>{fmtTime(v.recordedAt)}</td><td>{v.heartRate}</td><td>{v.bpSystolic}</td><td>{v.spO2}</td><td>{v.tempCelsius}</td><td>{v.respiratoryRate}</td>
                            <td>{v.news2Score} ({v.riskLevel})</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Section>

                <Section title="Lab results" icon={<FlaskConical className="h-4 w-4" />}>
                  {emr.labs.length === 0 ? (
                    <Empty text="No lab results." />
                  ) : (
                    <table className="w-full text-left">
                      <thead className="text-slate-400"><tr><th>Test</th><th>Value</th><th>Reference</th><th>Status</th><th>Date</th></tr></thead>
                      <tbody className="text-slate-200">
                        {emr.labs.map((l) => (
                          <tr key={l.id}>
                            <td>{l.testName}</td>
                            <td className="font-mono">{l.value} {l.unit}</td>
                            <td className="text-slate-400">{l.referenceRange}</td>
                            <td className={l.status === 'CRITICAL' ? 'text-rose-400 font-bold' : l.status === 'ABNORMAL' ? 'text-amber-400' : 'text-emerald-400'}>{l.status}</td>
                            <td className="text-slate-400">{fmtTime(l.date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Section>

                <Section title="Imaging studies" icon={<ImageIcon className="h-4 w-4" />}>
                  {emr.imaging.length === 0 ? (
                    <Empty text="No imaging studies." />
                  ) : (
                    <ul className="space-y-1 text-slate-200">
                      {emr.imaging.map((s) => (
                        <li key={s.id}>
                          <span className="font-bold">{s.modality}</span> — {s.description} ({fmtTime(s.studyDate ?? s.createdAt)})
                          {s.impression ? <span className="text-slate-400"> • Impression: {s.impression}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>

              <form onSubmit={submit} className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
                <fieldset disabled={closed} className={`space-y-4 min-w-0 ${closed ? 'opacity-50' : ''}`}>
                <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
                  <FileText className="h-5 w-5 text-indigo-400" /> Record Consultation
                </h3>
                <div>
                  <label className={labelCls}>Diagnosis *</label>
                  <input required value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Prescriptions (comma or line separated)</label>
                  <textarea rows={2} value={prescriptions} onChange={(e) => setPrescriptions(e.target.value)} className={inputCls} placeholder="e.g. Amoxicillin 500mg TID, Paracetamol 500mg PRN" />
                </div>
                <div>
                  <label className={labelCls}>Clinical notes *</label>
                  <textarea required rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
                </div>

                {blockSafety && (
                  <div className="space-y-3">
                    <SafetyPanel safety={blockSafety} />
                    <div>
                      <label className={labelCls}>Override reason (required to submit despite CRITICAL_BLOCK; recorded in the audit trail)</label>
                      <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                )}
                <ErrorBox message={submitError} />

                <button
                  type="submit"
                  disabled={closed || submitting || (!!blockSafety && !overrideReason.trim())}
                  className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 py-3 text-base font-bold text-white  disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : blockSafety ? 'Submit with override' : 'Record consultation'}
                </button>

                {result && (
                  <div className="space-y-3">
                    <SuccessBox message={`Consultation ${result.consultationId} recorded for ${result.patientName}.`} />
                    <SafetyPanel safety={result.safety} />
                  </div>
                )}
                </fieldset>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const toneCls: Record<string, string> = {
  rose: 'text-rose-300 border-rose-500/30',
  indigo: 'text-indigo-300 border-indigo-500/30',
  amber: 'text-amber-300 border-amber-500/30',
};

const ListBox: React.FC<{ title: string; items: string[]; tone: string; icon?: React.ReactNode }> = ({ title, items, tone, icon }) => (
  <div className={`rounded-xl bg-slate-950 p-3 border ${toneCls[tone]}`}>
    <p className="font-bold text-sm uppercase mb-1 flex items-center gap-1">{icon}{title}</p>
    {items.length === 0 ? <p className="text-slate-500">None recorded</p> : items.map((i, idx) => <p key={idx}>{i}</p>)}
  </div>
);

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="rounded-xl bg-slate-950 p-3 border border-slate-700 overflow-x-auto">
    <p className="font-bold text-slate-300 text-sm uppercase mb-2 flex items-center gap-1">{icon}{title}</p>
    {children}
  </div>
);
