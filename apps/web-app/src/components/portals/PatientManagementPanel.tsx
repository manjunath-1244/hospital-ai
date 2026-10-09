'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Users, Search, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import type { Patient, PatientDeleteResult, PatientList } from '../../lib/types';
import { STAGE_TABS, type PatientStage, type VisitStatus, type VisitSummary } from '../../lib/visits';
import { ErrorBox, Loading, PriorityBadge, StatusBadge, SuccessBox, fmtTime, fmtWait } from '../ui/common';
import { Alert, Button, Card, EmptyState, Field, Input, SectionTitle, TableFrame, Tabs } from '../ui/kit';
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
    <Card className="space-y-4">
      <SectionTitle icon={<Users className="h-5 w-5" />} className="!mb-0">
        Patient Management {items && <span className="text-base font-normal text-ink-3">({items.length} of {total})</span>}
      </SectionTitle>
      <Field label="Search patients">
        {(id) => (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-ink-3" aria-hidden />
            <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID" className="pl-10" />
          </div>
        )}
      </Field>
      <Tabs label="Patient stage" tabs={STAGE_TABS.map((t) => ({ id: t.id, label: t.label }))} value={stage} onChange={(id) => setStage(id as PatientStage)} />
      <SuccessBox message={msg} />
      <ErrorBox message={error} />
      {!items && !error && <Loading text="Loading patients..." />}
      {items && items.length === 0 && <EmptyState title="No patients found." hint="Try a different search or stage." />}
      {items && items.length > 0 && (
        <TableFrame>
          <table data-testid="patient-management-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Name</th>
                <th scope="col">Age / Gender</th>
                <th scope="col">Visit status</th>
                <th scope="col">Priority</th>
                <th scope="col">Chief complaint</th>
                <th scope="col">Wait</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const action = actionFor(p.visit);
                return (
                  <React.Fragment key={p.id}>
                    <tr>
                      <td className="font-mono">{p.id}</td>
                      <td className="font-semibold text-ink">{p.name}</td>
                      <td>{p.age}y {p.gender}</td>
                      <td><StatusBadge visit={p.visit} /></td>
                      <td><PriorityBadge priority={p.visit?.priority} /></td>
                      <td className="max-w-[200px] truncate" title={p.visit?.chiefComplaint ?? ''}>{p.visit?.chiefComplaint || '—'}</td>
                      <td className="whitespace-nowrap">{fmtWait(p.visit?.waitMinutes)}</td>
                      <td className="whitespace-nowrap">
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => toggleHistory(p)}
                            aria-expanded={openId === p.id}
                            icon={openId === p.id ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                          >
                            Visits
                          </Button>
                          {action && p.visit && (
                            <Button
                              variant={action === REOPEN ? 'primary' : 'secondary'}
                              size="sm"
                              onClick={() => openVisitModal(p, p.visit as VisitSummary, action)}
                            >
                              {action.label}
                            </Button>
                          )}
                          <Button variant="danger" size="sm" onClick={() => openDelete(p)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {openId === p.id && (
                      <tr>
                        <td colSpan={8}>
                          <div className="rounded-lg border border-line bg-surface-muted p-3">
                            <p className="mb-2 text-xs font-semibold uppercase text-ink-3">Visit history (registered {fmtTime(p.registeredAt)})</p>
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
        </TableFrame>
      )}

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-labelledby="patient-modal-title">
          <div className="w-full max-w-xl space-y-5 rounded-card border border-line bg-surface p-6 shadow-pop">
            {modal.kind === 'visit' ? (
              <>
                <h2 id="patient-modal-title" className="text-lg font-semibold text-ink">{modal.action.label}: {modal.patient.name} ({modal.patient.id})</h2>
                <Field label={modal.action.noteRequired ? 'Reason (required)' : 'Note (optional)'}>
                  {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
                </Field>
              </>
            ) : (
              <>
                <h2 id="patient-modal-title" className="flex items-center gap-2 text-lg font-semibold text-danger-700"><AlertTriangle className="h-5 w-5" aria-hidden /> Permanently delete {modal.patient.name}</h2>
                <Alert tone="danger">
                  This permanently deletes the patient and ALL their labs, vitals, consultations, imaging, appointments, tasks, FHIR record and AI index. This cannot be undone.
                </Alert>
                <Field label={`Type the patient ID ${modal.patient.id} to confirm`}>
                  {(id) => <Input id={id} value={typedId} onChange={(e) => setTypedId(e.target.value)} className="font-mono" autoFocus />}
                </Field>
              </>
            )}
            <ErrorBox message={modalError} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)} disabled={modalBusy}>
                Cancel
              </Button>
              {modal.kind === 'visit' ? (
                <Button onClick={confirmModal} disabled={modalBusy || (modal.action.noteRequired && !reason.trim())}>
                  {modalBusy ? 'Working...' : modal.action.label}
                </Button>
              ) : (
                <Button variant="danger" onClick={confirmModal} disabled={modalBusy || typedId !== modal.patient.id}>
                  {modalBusy ? 'Deleting...' : 'Delete permanently'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
