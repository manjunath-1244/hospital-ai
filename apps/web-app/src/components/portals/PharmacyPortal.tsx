'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Pill, ShieldCheck } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { PharmacyQueueItem, Safety } from '../../lib/types';
import { ErrorBox, Loading, SafetyPanel, fmtTime, splitList } from '../ui/common';
import { Button, Card, EmptyState, Field, PageHeader, SectionTitle, StatTile, Textarea } from '../ui/kit';
import { PatientPicker } from '../ui/PatientPicker';
import { useRealtime } from '../../context/RoleContext';

export const PharmacyPortal: React.FC = () => {
  const [queue, setQueue] = useState<PharmacyQueueItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [patientId, setPatientId] = useState('');
  const [meds, setMeds] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [audit, setAudit] = useState<Safety | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await apiFetch<PharmacyQueueItem[]>('/hospital/pharmacy/queue'));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);
  useRealtime(['doctor.consulted'], load);

  const runAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuditing(true);
    setAuditError('');
    setAudit(null);
    try {
      setAudit(await apiFetch<Safety>('/hospital/pharmacy/audit', { method: 'POST', body: { patientId, medications: splitList(meds) } }));
    } catch (err) {
      setAuditError(errorMessage(err));
    } finally {
      setAuditing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Pill className="h-6 w-6" />}
        title="Clinical Pharmacy: Prescription Queue & Safety Audit"
        subtitle="Review recent prescriptions with their safety findings, or audit medications ad hoc."
        actions={<div className="min-w-28"><StatTile label="In queue" value={queue?.length ?? '—'} /></div>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card as="div" className="lg:col-span-1">
          <form onSubmit={runAudit} className="space-y-4">
            <SectionTitle icon={<ShieldCheck className="h-5 w-5" />} className="!mb-0">Ad-hoc Medication Audit</SectionTitle>
            <PatientPicker value={patientId} onChange={setPatientId} />
            <Field label="Medications (comma or line separated)">
              {(id) => <Textarea id={id} rows={3} required value={meds} onChange={(e) => setMeds(e.target.value)} />}
            </Field>
            <ErrorBox message={auditError} />
            <Button
              type="submit"
              loading={auditing}
              disabled={auditing || !patientId || splitList(meds).length === 0}
              className="w-full"
              data-testid="pharmacy-audit-submit"
            >
              {auditing ? 'Auditing...' : 'Run safety audit'}
            </Button>
            {audit && <SafetyPanel safety={audit} />}
          </form>
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <SectionTitle className="!mb-0">Prescription Queue</SectionTitle>
          {loading && <Loading text="Loading queue..." />}
          <ErrorBox message={error} />
          {!loading && !error && queue?.length === 0 && (
            <EmptyState title="No prescriptions in the queue." hint="New prescriptions appear here after a doctor consultation." />
          )}
          <div className="space-y-3">
            {queue?.map((item) => (
              <div key={item.consultationId} data-testid="pharmacy-queue-item" className="space-y-2 rounded-lg border border-line bg-surface-muted p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-ink">{item.patientName} <span className="font-mono text-ink-3">({item.patientId})</span></p>
                  <span className="text-sm text-ink-3">{item.doctorName} • {fmtTime(item.createdAt)}</span>
                </div>
                <p className="text-ink-2">{item.prescriptions.length ? item.prescriptions.join(', ') : 'No prescriptions'}</p>
                <SafetyPanel safety={item.safety} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
