'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Clock, Printer, Bell, Search } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import type { Patient, PatientList, PossibleMatch, QueueResponse, RegisterOpResponse } from '../../lib/types';
import { isActiveStatus } from '../../lib/visits';
import { ErrorBox, SuccessBox, Loading, Empty, PriorityBadge, StatusBadge, fmtWait, inputCls, labelCls } from '../ui/common';

const emptyForm = { name: '', age: '', dob: '', gender: 'Male', phone: '', bloodType: 'O+', chiefComplaint: '' };

export const ReceptionistPortal: React.FC = () => {
  const [formData, setFormData] = useState(emptyForm);
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [actionError, setActionError] = useState('');
  const [matches, setMatches] = useState<PossibleMatch[]>([]);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Patient[] | null>(null);
  const [startingId, setStartingId] = useState('');

  const loadQueue = useCallback(async () => {
    try {
      setQueue(await apiFetch<QueueResponse>('/hospital/lifecycle/queue'));
      setQueueError('');
    } catch (e) {
      setQueueError(errorMessage(e));
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadQueue();
  }, [loadQueue]);
  useRealtime(['patient.registered', 'doctor.consulted', 'visit.updated'], loadQueue);

  // Search-before-register: look for an existing patient by name / phone / ID.
  const runSearch = useCallback(async () => {
    if (search.trim().length < 2) {
      setFound(null);
      return;
    }
    try {
      setFound((await apiFetch<PatientList>(`/hospital/patients?q=${encodeURIComponent(search.trim())}&limit=8`)).items);
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }, [search]);
  useEffect(() => {
    const t = setTimeout(runSearch, 300);
    return () => clearTimeout(t);
  }, [runSearch]);
  useRealtime(['visit.updated', 'patient.registered'], runSearch);

  const startVisit = async (patientId: string, name: string) => {
    setStartingId(patientId);
    setActionMsg('');
    setActionError('');
    try {
      await apiFetch(`/hospital/patients/${encodeURIComponent(patientId)}/visits`, {
        method: 'POST',
        body: formData.chiefComplaint.trim() ? { chiefComplaint: formData.chiefComplaint.trim() } : {},
      });
      setActionMsg(`New visit started for ${name} (${patientId}).`);
      setMatches([]);
      setFormData(emptyForm);
      loadQueue();
      runSearch();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setStartingId('');
    }
  };

  const register = async (allowDuplicate: boolean) => {
    setSubmitting(true);
    setFormError('');
    setSuccessMsg('');
    try {
      const res = await apiFetch<RegisterOpResponse>('/hospital/lifecycle/register-op', {
        method: 'POST',
        body: {
          name: formData.name.trim(),
          ...(formData.dob ? { dob: formData.dob } : {}),
          ...(formData.age !== '' ? { age: parseInt(formData.age, 10) } : {}),
          gender: formData.gender,
          phone: formData.phone.trim(),
          bloodType: formData.bloodType,
          ...(formData.chiefComplaint.trim() ? { chiefComplaint: formData.chiefComplaint.trim() } : {}),
          ...(allowDuplicate ? { allowDuplicate: true } : {}),
        },
      });
      setSuccessMsg(
        `Patient ${res.patient?.name ?? formData.name} registered as ${res.patientId}. FHIR sync: ${res.fhirSynced ? 'yes' : 'no'}; RAG indexed: ${res.ragIndexed ? 'yes' : 'no'}.`,
      );
      setFormData(emptyForm);
      setMatches([]);
      loadQueue();
    } catch (err) {
      const found = err instanceof ApiError && err.status === 409 ? (err.body as { possibleMatches?: PossibleMatch[] })?.possibleMatches : undefined;
      if (found?.length) {
        setMatches(found);
        setFormError(err instanceof ApiError ? err.message : '');
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.dob && formData.age === '') {
      setFormError('Enter the age or the date of birth.');
      return;
    }
    register(false);
  };

  const printToken = (name: string, id: string) => {
    const w = window.open('', '_blank', 'width=360,height=300');
    if (!w) {
      setActionError('Popup blocked: allow popups to print the token.');
      return;
    }
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
    w.document.write(
      `<html><head><title>OP Token</title></head><body style="font-family:sans-serif;text-align:center;padding:24px"><h2>OP Token</h2><h1>${esc(id)}</h1><p>${esc(name)}</p><p>${new Date().toLocaleString()}</p></body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const notifyDoctor = async (name: string, patientId: string) => {
    setActionMsg('');
    setActionError('');
    try {
      await apiFetch('/hospital/tasks', {
        method: 'POST',
        body: { title: `Patient ${name} (${patientId}) is waiting for consultation`, assignedTo: 'doctor', patientId, priority: 'MEDIUM' },
      });
      setActionMsg(`Task created for the doctor about ${name}.`);
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const waiting = queue?.items.filter((p) => p.visit.status === 'TRIAGED').length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-2xl glass-panel p-7 border-l-4 border-l-emerald-500">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <UserPlus className="h-8 w-8 text-emerald-400" />
            Front-Desk Outpatient Registration & Queue
          </h2>
          <p className="text-base text-slate-300 mt-1.5">Register walk-in patients and monitor the live waiting queue.</p>
        </div>
        <div className="hidden sm:flex gap-3">
          <div className="rounded-xl bg-slate-950 px-5 py-3 text-center border border-slate-700 min-w-28">
            <p className="text-sm text-slate-400">In Queue</p>
            <p className="text-3xl font-extrabold text-emerald-400">{queue?.items.length ?? '—'}</p>
          </div>
          <div className="rounded-xl bg-slate-950 px-5 py-3 text-center border border-slate-700 min-w-28">
            <p className="text-sm text-slate-400">For doctor</p>
            <p className="text-3xl font-extrabold text-amber-400">{queue ? waiting : '—'}</p>
          </div>
        </div>
      </div>

      <SuccessBox message={successMsg} />
      <SuccessBox message={actionMsg} />
      <ErrorBox message={actionError} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
          <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
            <UserPlus className="h-5 w-5 text-emerald-400" />
            OP Patient Registration
          </h3>
          <div className="space-y-2">
            <label className={labelCls}>Already registered? Search by name, phone or ID</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-5 w-5 text-slate-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type at least 2 characters" className={`${inputCls} pl-11`} />
            </div>
            {found && found.length === 0 && <p className="text-sm text-slate-400">No existing patient found. Register below.</p>}
            {found?.map((p) => (
              <div key={p.id} className="rounded-xl bg-slate-950 border border-slate-700 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-white truncate">{p.name} <span className="font-mono text-sm text-indigo-400">{p.id}</span></p>
                  <p className="text-sm text-slate-400">{p.age}y {p.gender} • {p.phone}</p>
                  <div className="mt-1"><StatusBadge visit={p.visit} /></div>
                </div>
                {isActiveStatus(p.visit?.status) ? (
                  <span className="text-xs text-slate-400 text-right">Visit already open</span>
                ) : (
                  <button type="button" disabled={startingId === p.id} onClick={() => startVisit(p.id, p.name)} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                    {startingId === p.id ? 'Starting...' : 'Start new visit'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>Full Name *</label>
              <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Age {formData.dob ? '(optional)' : '*'}</label>
                <input type="number" min={0} max={130} value={formData.age} onChange={(e) => setFormData({ ...formData, age: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Gender *</label>
                <select value={formData.gender} onChange={(e) => setFormData({ ...formData, gender: e.target.value })} className={inputCls}>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Date of birth (optional)</label>
              <input type="date" value={formData.dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setFormData({ ...formData, dob: e.target.value })} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Phone *</label>
                <input type="text" required value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Blood Type</label>
                <select value={formData.bloodType} onChange={(e) => setFormData({ ...formData, bloodType: e.target.value })} className={inputCls}>
                  {['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Chief Complaint</label>
              <textarea rows={2} value={formData.chiefComplaint} onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })} className={inputCls} />
            </div>
            <ErrorBox message={formError} />
            {matches.length > 0 && (
              <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                <p className="text-sm font-bold text-amber-200">Possible existing patient{matches.length > 1 ? 's' : ''}</p>
                {matches.map((m) => (
                  <div key={m.patientId} className="rounded-lg bg-slate-950 border border-slate-700 p-3 space-y-2">
                    <p className="font-bold text-white">{m.name} <span className="font-mono text-sm text-indigo-400">{m.patientId}</span></p>
                    <p className="text-sm text-slate-400">{m.age}y • {m.phone} • {m.strength} match ({m.reasons.map((r) => r.replace('SAME_', 'same ').toLowerCase()).join(', ')})</p>
                    <button type="button" disabled={startingId === m.patientId} onClick={() => startVisit(m.patientId, m.name)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                      Open this patient / start new visit
                    </button>
                  </div>
                ))}
                <button type="button" disabled={submitting} onClick={() => register(true)} className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm font-bold text-slate-100 hover:bg-slate-700 disabled:opacity-50">
                  This is a different person – register anyway
                </button>
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl min-h-12 bg-emerald-600 hover:bg-emerald-500 py-3 text-base font-bold text-white disabled:opacity-50"
            >
              {submitting ? 'Registering...' : 'Register OP Patient'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2 glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-700 pb-4">
            <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
              <Clock className="h-5 w-5 text-indigo-400" />
              Outpatient Queue
            </h3>
            {queue && <span className="text-sm text-slate-400 font-mono">Wait alert after {queue.waitAlertMinutes} min</span>}
          </div>

          {queueLoading && <Loading text="Loading queue..." />}
          <ErrorBox message={queueError} />
          {!queueLoading && !queueError && queue?.items.length === 0 && <Empty text="The queue is empty." />}

          {queue && queue.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                    <th className="pb-3 px-2">Patient ID</th>
                    <th className="pb-3 px-2">Name & Info</th>
                    <th className="pb-3 px-2">Wait</th>
                    <th className="pb-3 px-2">Chief Complaint</th>
                    <th className="pb-3 px-2">Priority</th>
                    <th className="pb-3 px-2">Status</th>
                    <th className="pb-3 px-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {queue.items.map((item) => (
                    <tr key={item.patientId} className="hover:bg-slate-900/60 transition-colors">
                      <td className="py-3 px-2 font-mono font-bold text-indigo-400">{item.patientId}</td>
                      <td className="py-3 px-2">
                        <p className="font-bold text-white">{item.name}</p>
                        <p className="text-sm text-slate-400">{item.age ?? '?'} yrs • {item.gender ?? '—'}</p>
                      </td>
                      <td className={`py-3 px-2 font-mono ${(item.visit.waitMinutes ?? 0) >= queue.waitAlertMinutes ? 'text-rose-400 font-bold' : 'text-slate-300'}`}>
                        {fmtWait(item.visit.waitMinutes)}
                      </td>
                      <td className="py-3 px-2 text-slate-300 max-w-[150px] truncate" title={item.chiefComplaint}>{item.chiefComplaint}</td>
                      <td className="py-3 px-2"><PriorityBadge priority={item.visit.priority} /></td>
                      <td className="py-3 px-2"><StatusBadge visit={item.visit} /></td>
                      <td className="py-3 px-2 text-right space-x-2">
                        <button
                          onClick={() => printToken(item.name, item.patientId)}
                          className="rounded-lg bg-slate-900 p-1.5 text-slate-300 hover:text-white border border-slate-700"
                          title="Print OP token"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => notifyDoctor(item.name, item.patientId)}
                          className="rounded-lg bg-indigo-600/30 p-1.5 text-indigo-300 hover:bg-indigo-600 hover:text-white border border-indigo-500/30"
                          title="Create a task for the doctor"
                        >
                          <Bell className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
