'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Users, Search, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import type { Patient, PatientDeleteResult, PatientList } from '../../lib/types';
import { STAGE_TABS, type PatientStage, type VisitStatus, type VisitSummary } from '../../lib/visits';
import { Empty, ErrorBox, Loading, PriorityBadge, StatusBadge, SuccessBox, fmtTime, fmtWait, inputCls, labelCls } from '../ui/common';
import { VisitHistory } from '../ui/VisitPanel';

/** A manual visit action offered per row; these map to allowed backend transitions. */
interface VisitAction { to: VisitStatus; label: string; noteRequired: boolean }
const COMPLETE: VisitAction = { to: 'COMPLETED', label: 'Complete visit', noteRequired: false };
const REOPEN: VisitAction = { to: 'IN_CONSULTATION', label: 'Reopen visit', noteRequired: true };
const CANCEL: VisitAction = { to: 'CANCELLED', label: 'Cancel visit', noteRequired: true };

const actionFor = (v: VisitSummary | null | undefined): VisitAction | null => {
  if (!v) return null;
  if (v.status === 'COMPLETED') return REOPEN;
  if (v.status === 'WAITING_TRIAGE' || v.status === 'TRIAGED') return CANCEL;
  if (v.status === 'CANCELLED' || v.status === 'LEFT_WITHOUT_SEEN') return null;
  return COMPLETE;
};

type Modal = { kind: 'visit'; patient: Patient; visit: VisitSummary; action: VisitAction } | { kind: 'delete'; patient: Patient } | null;

export const PatientManagementPanel: React.FC = () => {
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<PatientStage>('ACTIVE');
  const [openId, setOpenId] = useState('');
  const [history, setHistory] = useState<VisitSummary[]>([]);
  const [items, setItems] = useState<Patient[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [modal, setModal] = useState<Modal>(null);
  const [reason, setReason] = useState('');
  const [typedId, setTypedId] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<PatientList>(`/hospital/patients?q=${encodeURIComponent(q)}&stage=${stage}&limit=100`);
      setItems(r.items);
      setTotal(r.total);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q, stage]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useRealtime(['patient.registered', 'visit.updated', 'patient.deleted'], load);

  const openVisitModal = (patient: Patient, visit: VisitSummary, action: VisitAction) => {
    setModal({ kind: 'visit', patient, visit, action });
    setReason('');
    setModalError('');
  };
  const openDelete = (patient: Patient) => {
    setModal({ kind: 'delete', patient });
    setTypedId('');
    setModalError('');
  };

  const toggleHistory = async (p: Patient) => {
    if (openId === p.id) {
      setOpenId('');
      return;
    }
    setOpenId(p.id);
    setHistory([]);
    try {
      setHistory(await apiFetch<VisitSummary[]>(`/hospital/patients/${encodeURIComponent(p.id)}/visits`));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const confirmModal = async () => {
    if (!modal) return;
    const { patient } = modal;
    setModalBusy(true);
    setModalError('');
    try {
      if (modal.kind === 'visit') {
        const { visit, action } = modal;
        await apiFetch(`/hospital/visits/${encodeURIComponent(visit.id)}/transition`, {
          method: 'POST',
          body: { to: action.to, ...(reason.trim() ? { note: reason.trim() } : {}), ...(action.to === 'COMPLETED' ? { outcome: 'DISCHARGED' } : {}) },
        });
        setMsg(`${action.label}: ${patient.name} (${patient.id}).`);
        if (openId === patient.id) setOpenId('');
      } else {
        const r = await apiFetch<PatientDeleteResult>(
          `/hospital/patients/${encodeURIComponent(patient.id)}?confirm=${encodeURIComponent(typedId)}`,
          { method: 'DELETE' },
        );
        const d = r.deleted;
        setMsg(
          `Deleted ${r.patientId}: ${d.labs} labs, ${d.vitals} vitals, ${d.consultations} consultations, ${d.imaging} imaging, ${d.appointments} appointments, ${d.tasks} tasks; FHIR record ${r.fhirDeleted ? 'deleted' : 'not found'}; ${r.ragChunksRemoved} AI index chunks removed.`,
        );
      }
      setModal(null);
      await load();
    } catch (e) {
      setModalError(errorMessage(e));
    } finally {
      setModalBusy(false);
    }
  };

  return (
    <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
      <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
        <Users className="h-5 w-5 text-rose-400" /> Patient Management {items && <span className="text-slate-400 normal-case font-normal">({items.length} of {total})</span>}
      </h3>
      <div className="relative">
        <Search className="absolute left-3 top-3 h-5 w-5 text-slate-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID" className={`${inputCls} pl-11`} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STAGE_TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setStage(t.id)} className={`rounded-lg px-3 py-1.5 text-sm font-bold border ${stage === t.id ? 'bg-rose-600 border-rose-400 text-white' : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <SuccessBox message={msg} />
      <ErrorBox message={error} />
      {!items && !error && <Loading text="Loading patients..." />}
      {items && items.length === 0 && <Empty text="No patients found." />}
      {items && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="pb-2 px-2">ID</th><th className="pb-2 px-2">Name</th><th className="pb-2 px-2">Age / Gender</th><th className="pb-2 px-2">Visit status</th><th className="pb-2 px-2">Priority</th><th className="pb-2 px-2">Chief complaint</th><th className="pb-2 px-2">Wait</th><th className="pb-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {items.map((p) => {
                const action = actionFor(p.visit);
                return (
                  <React.Fragment key={p.id}>
                    <tr>
                      <td className="py-2 px-2 font-mono">{p.id}</td>
                      <td className="py-2 px-2 font-semibold text-white">{p.name}</td>
                      <td className="py-2 px-2">{p.age}y {p.gender}</td>
                      <td className="py-2 px-2"><StatusBadge visit={p.visit} /></td>
                      <td className="py-2 px-2"><PriorityBadge priority={p.visit?.priority} /></td>
                      <td className="py-2 px-2 max-w-[200px] truncate" title={p.visit?.chiefComplaint ?? ''}>{p.visit?.chiefComplaint || '—'}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtWait(p.visit?.waitMinutes)}</td>
                      <td className="py-2 px-2 whitespace-nowrap space-x-1">
                        <button onClick={() => toggleHistory(p)} className="rounded-lg bg-slate-900 px-2.5 py-1 text-sm font-bold text-slate-300 border border-slate-700 hover:text-white inline-flex items-center gap-1" aria-expanded={openId === p.id}>
                          {openId === p.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Visits
                        </button>
                        {action && p.visit && (
                          <button
                            onClick={() => openVisitModal(p, p.visit as VisitSummary, action)}
                            className={`rounded-lg px-2.5 py-1 text-sm font-bold ${action === REOPEN ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'}`}
                          >
                            {action.label}
                          </button>
                        )}
                        <button onClick={() => openDelete(p)} className="rounded-lg bg-rose-600 px-2.5 py-1 text-sm font-bold text-white hover:bg-rose-500">
                          Delete
                        </button>
                      </td>
                    </tr>
                    {openId === p.id && (
                      <tr>
                        <td colSpan={8} className="px-2 pb-3">
                          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
                            <p className="font-bold text-slate-400 uppercase text-xs mb-2">Visit history (registered {fmtTime(p.registeredAt)})</p>
                            <VisitHistory visits={history} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl rounded-2xl glass-panel border border-slate-600 p-8 space-y-5 bg-slate-900">
            {modal.kind === 'visit' ? (
              <>
                <h4 className="text-xl font-bold text-white">{modal.action.label}: {modal.patient.name} ({modal.patient.id})</h4>
                <div>
                  <label className={labelCls}>{modal.action.noteRequired ? 'Reason (required)' : 'Note (optional)'}</label>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} autoFocus />
                </div>
              </>
            ) : (
              <>
                <h4 className="text-xl font-bold text-rose-300 flex items-center gap-2"><AlertTriangle className="h-6 w-6" /> Permanently delete {modal.patient.name}</h4>
                <p className="text-base text-slate-200 leading-relaxed">
                  This permanently deletes the patient and ALL their labs, vitals, consultations, imaging, appointments, tasks, FHIR record and AI index. This cannot be undone.
                </p>
                <div>
                  <label className={labelCls}>Type the patient ID <span className="font-mono text-rose-300">{modal.patient.id}</span> to confirm</label>
                  <input value={typedId} onChange={(e) => setTypedId(e.target.value)} className={`${inputCls} font-mono`} autoFocus />
                </div>
              </>
            )}
            <ErrorBox message={modalError} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} disabled={modalBusy} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-slate-300 border border-slate-700 hover:text-white disabled:opacity-50">
                Cancel
              </button>
              {modal.kind === 'visit' ? (
                <button onClick={confirmModal} disabled={modalBusy || (modal.action.noteRequired && !reason.trim())} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
                  {modalBusy ? 'Working...' : modal.action.label}
                </button>
              ) : (
                <button onClick={confirmModal} disabled={modalBusy || typedId !== modal.patient.id} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-40">
                  {modalBusy ? 'Deleting...' : 'Delete permanently'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
