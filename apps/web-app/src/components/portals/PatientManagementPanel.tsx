'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Users, Search, AlertTriangle } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import type { Patient, PatientDeleteResult, PatientList } from '../../lib/types';
import { Empty, ErrorBox, Loading, SuccessBox, fmtTime, inputCls, labelCls } from '../ui/common';

const chip: Record<Patient['consultationStatus'], string> = {
  WAITING: 'bg-amber-500/20 text-amber-400',
  SEEN: 'bg-emerald-500/20 text-emerald-400',
  CLOSED: 'bg-slate-600/40 text-slate-300',
};

type Modal = { kind: 'close' | 'delete'; patient: Patient } | null;

export const PatientManagementPanel: React.FC = () => {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Patient[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busyId, setBusyId] = useState('');

  const [modal, setModal] = useState<Modal>(null);
  const [reason, setReason] = useState('');
  const [typedId, setTypedId] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<PatientList>(`/hospital/patients?q=${encodeURIComponent(q)}&limit=100`);
      setItems(r.items);
      setTotal(r.total);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useRealtime(['patient.registered', 'patient.closed', 'patient.reopened', 'patient.deleted'], load);

  const openModal = (kind: 'close' | 'delete', patient: Patient) => {
    setModal({ kind, patient });
    setReason('');
    setTypedId('');
    setModalError('');
  };

  const reopen = async (p: Patient) => {
    setBusyId(p.id);
    setMsg('');
    setError('');
    try {
      await apiFetch<Patient>(`/hospital/patients/${encodeURIComponent(p.id)}/reopen`, { method: 'POST', body: {} });
      setMsg(`Reopened ${p.name} (${p.id}).`);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId('');
    }
  };

  const confirmModal = async () => {
    if (!modal) return;
    const { kind, patient } = modal;
    setModalBusy(true);
    setModalError('');
    try {
      if (kind === 'close') {
        await apiFetch<Patient>(`/hospital/patients/${encodeURIComponent(patient.id)}/close`, {
          method: 'POST',
          body: reason.trim() ? { reason: reason.trim() } : {},
        });
        setMsg(`Closed session for ${patient.name} (${patient.id}).`);
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
        <Search className="absolute left-3 top-2.5 h-5 w-5 text-slate-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID" className={`${inputCls} pl-11`} />
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
                <th className="pb-2 px-2">ID</th><th className="pb-2 px-2">Name</th><th className="pb-2 px-2">Age / Gender</th><th className="pb-2 px-2">Status</th><th className="pb-2 px-2">Registered</th><th className="pb-2 px-2">Closed</th><th className="pb-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 px-2 font-mono">{p.id}</td>
                  <td className="py-2 px-2 font-semibold text-white">{p.name}</td>
                  <td className="py-2 px-2">{p.age}y {p.gender}</td>
                  <td className="py-2 px-2"><span className={`rounded px-2 py-0.5 text-xs font-bold ${chip[p.consultationStatus] ?? chip.SEEN}`}>{p.consultationStatus}</span></td>
                  <td className="py-2 px-2 whitespace-nowrap">{fmtTime(p.registeredAt)}</td>
                  <td className="py-2 px-2 text-sm">
                    {p.consultationStatus === 'CLOSED' ? (
                      <>
                        {p.closedBy ?? '—'} • {fmtTime(p.closedAt)}
                        {p.closeReason && <span className="block text-slate-400">{p.closeReason}</span>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap space-x-1">
                    {p.consultationStatus === 'CLOSED' ? (
                      <button disabled={busyId === p.id} onClick={() => reopen(p)} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                        {busyId === p.id ? 'Reopening...' : 'Reopen'}
                      </button>
                    ) : (
                      <button onClick={() => openModal('close', p)} className="rounded-lg bg-slate-800 px-2.5 py-1 text-sm font-bold text-slate-200 border border-slate-700 hover:bg-slate-700">
                        Close session
                      </button>
                    )}
                    <button onClick={() => openModal('delete', p)} className="rounded-lg bg-rose-600 px-2.5 py-1 text-sm font-bold text-white hover:bg-rose-500">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl rounded-2xl glass-panel border border-slate-600 p-8 space-y-5 bg-slate-900">
            {modal.kind === 'close' ? (
              <>
                <h4 className="text-xl font-bold text-white">Close session for {modal.patient.name} ({modal.patient.id})</h4>
                <div>
                  <label className={labelCls}>Reason (optional)</label>
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
              {modal.kind === 'close' ? (
                <button onClick={confirmModal} disabled={modalBusy} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
                  {modalBusy ? 'Closing...' : 'Close session'}
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
