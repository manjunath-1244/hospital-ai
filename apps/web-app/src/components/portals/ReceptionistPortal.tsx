'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Clock, Printer, Bell, Search } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { ApiError, apiFetch, errorMessage } from '../../lib/api';
import type { Patient, PatientList, PossibleMatch, QueueResponse, RegisterOpResponse } from '../../lib/types';
import { isActiveStatus } from '../../lib/visits';
import { AppointmentBooking } from '../ui/AppointmentBooking';
import { PatientManagementPanel } from './PatientManagementPanel';
import { ErrorBox, SuccessBox, Loading, PriorityBadge, StatusBadge, fmtWait } from '../ui/common';
import { Button, Card, EmptyState, Field, Input, PageHeader, SectionTitle, Select, StatTile, TableFrame, Textarea } from '../ui/kit';

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
      <PageHeader
        icon={<UserPlus className="h-6 w-6" />}
        title="Front-Desk Outpatient Registration & Queue"
        subtitle="Register walk-in patients and monitor the live waiting queue."
        actions={
          <>
            <div className="min-w-28"><StatTile label="In queue" value={queue?.items.length ?? '—'} /></div>
            <div className="min-w-28"><StatTile label="For doctor" value={queue ? waiting : '—'} tone="warning" /></div>
          </>
        }
      />

      <SuccessBox message={successMsg} />
      <SuccessBox message={actionMsg} />
      <ErrorBox message={actionError} />

      <AppointmentBooking collapsible />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="space-y-4 lg:col-span-1">
          <SectionTitle icon={<UserPlus className="h-5 w-5" />} className="!mb-0">OP Patient Registration</SectionTitle>
          <div className="space-y-2">
            <Field label="Already registered? Search by name, phone or ID">
              {(id) => (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-ink-3" aria-hidden />
                  <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type at least 2 characters" className="pl-10" />
                </div>
              )}
            </Field>
            {found && found.length === 0 && <p className="text-sm text-ink-3">No existing patient found. Register below.</p>}
            {found?.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{p.name} <span className="font-mono text-sm text-ink-3">{p.id}</span></p>
                  <p className="text-sm text-ink-3">{p.age}y {p.gender} • {p.phone}</p>
                  <div className="mt-1"><StatusBadge visit={p.visit} /></div>
                </div>
                {isActiveStatus(p.visit?.status) ? (
                  <span className="text-right text-xs text-ink-3">Visit already open</span>
                ) : (
                  <Button size="sm" disabled={startingId === p.id} onClick={() => startVisit(p.id, p.name)} className="shrink-0">
                    {startingId === p.id ? 'Starting...' : 'Start new visit'}
                  </Button>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Full Name *">
              {(id) => <Input id={id} type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />}
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={`Age ${formData.dob ? '(optional)' : '*'}`}>
                {(id) => <Input id={id} type="number" min={0} max={130} value={formData.age} onChange={(e) => setFormData({ ...formData, age: e.target.value })} />}
              </Field>
              <Field label="Gender *">
                {(id) => (
                  <Select id={id} value={formData.gender} onChange={(e) => setFormData({ ...formData, gender: e.target.value })}>
                    <option>Male</option>
                    <option>Female</option>
                    <option>Other</option>
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Date of birth (optional)">
              {(id) => <Input id={id} type="date" value={formData.dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setFormData({ ...formData, dob: e.target.value })} />}
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Phone *">
                {(id) => <Input id={id} type="text" required value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />}
              </Field>
              <Field label="Blood Type">
                {(id) => (
                  <Select id={id} value={formData.bloodType} onChange={(e) => setFormData({ ...formData, bloodType: e.target.value })}>
                    {['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Chief Complaint">
              {(id) => <Textarea id={id} rows={2} value={formData.chiefComplaint} onChange={(e) => setFormData({ ...formData, chiefComplaint: e.target.value })} />}
            </Field>
            <ErrorBox message={formError} />
            {matches.length > 0 && (
              <div className="space-y-3 rounded-lg border border-warning-200 bg-warning-50 p-4">
                <p className="text-sm font-semibold text-warning-700">Possible existing patient{matches.length > 1 ? 's' : ''}</p>
                {matches.map((m) => (
                  <div key={m.patientId} className="space-y-2 rounded-lg border border-line bg-surface p-3">
                    <p className="font-semibold text-ink">{m.name} <span className="font-mono text-sm text-ink-3">{m.patientId}</span></p>
                    <p className="text-sm text-ink-3">{m.age}y • {m.phone} • {m.strength} match ({m.reasons.map((r) => r.replace('SAME_', 'same ').toLowerCase()).join(', ')})</p>
                    <Button size="sm" disabled={startingId === m.patientId} onClick={() => startVisit(m.patientId, m.name)}>
                      Open this patient / start new visit
                    </Button>
                  </div>
                ))}
                <Button variant="secondary" disabled={submitting} onClick={() => register(true)} className="w-full">
                  This is a different person – register anyway
                </Button>
              </div>
            )}
            <Button type="submit" disabled={submitting} className="w-full" data-testid="register-op-submit">
              {submitting ? 'Registering...' : 'Register OP Patient'}
            </Button>
          </form>
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <SectionTitle
            icon={<Clock className="h-5 w-5" />}
            className="!mb-0"
            actions={queue ? <span className="text-sm text-ink-3">Wait alert after {queue.waitAlertMinutes} min</span> : undefined}
          >
            Outpatient Queue
          </SectionTitle>

          {queueLoading && <Loading text="Loading queue..." />}
          <ErrorBox message={queueError} />
          {!queueLoading && !queueError && queue?.items.length === 0 && (
            <EmptyState title="The queue is empty." hint="Registered patients appear here until their visit is completed." />
          )}

          {queue && queue.items.length > 0 && (
            <TableFrame>
              <table data-testid="op-queue-table">
                <thead>
                  <tr>
                    <th scope="col">Patient ID</th>
                    <th scope="col">Name & Info</th>
                    <th scope="col">Wait</th>
                    <th scope="col">Chief Complaint</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((item) => {
                    const overdue = (item.visit.waitMinutes ?? 0) >= queue.waitAlertMinutes;
                    return (
                      <tr key={item.patientId}>
                        <td className="font-mono font-semibold text-ink">{item.patientId}</td>
                        <td>
                          <p className="font-semibold text-ink">{item.name}</p>
                          <p className="text-sm text-ink-3">{item.age ?? '?'} yrs • {item.gender ?? '—'}</p>
                        </td>
                        <td className={overdue ? 'font-semibold text-danger-700' : 'text-ink-2'}>
                          {fmtWait(item.visit.waitMinutes)}
                          {overdue && <span className="block text-xs">Over limit</span>}
                        </td>
                        <td className="max-w-[150px] truncate text-ink-2" title={item.chiefComplaint}>{item.chiefComplaint}</td>
                        <td><PriorityBadge priority={item.visit.priority} /></td>
                        <td><StatusBadge visit={item.visit} /></td>
                        <td className="whitespace-nowrap text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => printToken(item.name, item.patientId)}
                              title="Print OP token"
                              aria-label={`Print OP token for ${item.name}`}
                              className="!min-h-10 !min-w-10 !px-2"
                            >
                              <Printer className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => notifyDoctor(item.name, item.patientId)}
                              title="Create a task for the doctor"
                              aria-label={`Create a task for the doctor about ${item.name}`}
                              className="!min-h-10 !min-w-10 !px-2"
                            >
                              <Bell className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableFrame>
          )}
        </Card>
      </div>

      <PatientManagementPanel />
    </div>
  );
};
