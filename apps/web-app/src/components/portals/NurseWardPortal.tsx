'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Activity, FileText, Mic } from 'lucide-react';
import { useRealtime } from '../../context/RoleContext';
import { apiFetch, errorMessage } from '../../lib/api';
import type { DocumentResponse, WardEntry } from '../../lib/types';
import { LabResultForm } from '../ui/LabResultForm';
import { PendingActionsPanel } from './PendingActionsPanel';
import { AiDraftBanner, ErrorBox, Loading, fmtTime } from '../ui/common';
import { Badge, Button, Card, EmptyState, SectionTitle, StatTile, cx } from '../ui/kit';

const riskCls = (r: string) =>
  r === 'HIGH' ? 'border-danger-200 bg-danger-50' : r === 'MEDIUM' || r === 'LOW_MEDIUM' ? 'border-warning-200 bg-warning-50' : 'border-line bg-surface';
const riskTone = (r: string) => (r === 'HIGH' ? 'danger' : r === 'MEDIUM' || r === 'LOW_MEDIUM' ? 'warning' : 'neutral');

export const NurseWardPortal: React.FC = () => {
  const [ward, setWard] = useState<WardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [sbar, setSbar] = useState<DocumentResponse | null>(null);
  const [sbarLoading, setSbarLoading] = useState(false);
  const [sbarError, setSbarError] = useState('');

  const load = useCallback(async () => {
    try {
      setWard(await apiFetch<WardEntry[]>('/hospital/lifecycle/ward'));
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
  useRealtime(['alert.news2_deterioration'], load);

  const generate = async () => {
    setSbarLoading(true);
    setSbarError('');
    setSbar(null);
    try {
      setSbar(await apiFetch<DocumentResponse>('/ai/documents', { method: 'POST', body: { type: 'SBAR', patientId: selected } }));
    } catch (e) {
      setSbarError(errorMessage(e));
    } finally {
      setSbarLoading(false);
    }
  };

  const selectedName = ward?.find((w) => w.patientId === selected)?.name ?? selected;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <SectionTitle icon={<Activity className="h-5 w-5" />} hint="Latest recorded NEWS2 per patient, highest score first." className="mb-0">
          Ward Monitoring & SBAR Handoff
        </SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatTile label="Patients" value={ward?.length ?? '—'} />
          <StatTile label="High risk" value={ward ? ward.filter((w) => w.latest.riskLevel === 'HIGH').length : '—'} tone="danger" />
        </div>
      </section>

      <Card>
        <SectionTitle icon={<Activity className="h-5 w-5" />}>Ward NEWS2 Overview</SectionTitle>
        <div className="space-y-4">
          {loading && <Loading text="Loading ward..." />}
          <ErrorBox message={error} />
          {!loading && !error && ward?.length === 0 && <EmptyState title="No patients with recorded vitals." hint="Patients appear here once vitals have been recorded." />}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ward?.map((p) => (
              <button
                key={p.patientId}
                type="button"
                data-testid="ward-patient"
                aria-pressed={selected === p.patientId}
                onClick={() => setSelected(p.patientId)}
                className={cx('min-h-11 space-y-1 rounded-lg border p-4 text-left text-sm', riskCls(p.latest.riskLevel), selected === p.patientId && 'ring-2 ring-brand-500')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{p.name}</span>
                  <span className="font-mono font-semibold text-ink">NEWS2 {p.latest.news2Score}</span>
                </div>
                <p className="flex flex-wrap items-center gap-2 text-ink-3">
                  <span>{p.patientId} • {p.age}y {p.gender}</span>
                  <Badge tone={riskTone(p.latest.riskLevel)}>{p.latest.riskLevel}</Badge>
                </p>
                <p className="font-mono text-ink-2">
                  HR {p.latest.heartRate} | SBP {p.latest.bpSystolic} | SpO2 {p.latest.spO2}% | T {p.latest.tempCelsius} | RR {p.latest.respiratoryRate}
                </p>
                <p className="text-ink-3">{fmtTime(p.latest.recordedAt)}</p>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <PendingActionsPanel />

      <Card>
        <SectionTitle>Lab results</SectionTitle>
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            {selected ? `Recording for ${selectedName} (${selected}).` : 'Select a patient card above to add a lab result.'}
          </p>
          <LabResultForm patientId={selected} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle icon={<FileText className="h-5 w-5" />}>SBAR Handoff</SectionTitle>
          <div className="space-y-4">
            <p className="text-sm text-ink-3">{selected ? `Selected patient: ${selectedName}` : 'Select a patient card above.'}</p>
            <Button onClick={generate} disabled={!selected || sbarLoading} loading={sbarLoading} className="w-full" data-testid="sbar-generate">
              {sbarLoading ? 'Generating...' : 'Generate SBAR draft'}
            </Button>
            <ErrorBox message={sbarError} />
            {sbar && (
              <div className="space-y-3">
                <AiDraftBanner />
                <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-muted p-4 font-sans text-sm text-ink">{sbar.content}</pre>
                <p className="text-sm text-ink-3">{sbar.disclaimer}</p>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <SectionTitle icon={<Mic className="h-5 w-5" />}>Voice Scribe</SectionTitle>
          <Button variant="secondary" disabled className="w-full">
            Voice scribe – not implemented
          </Button>
        </Card>
      </div>
    </div>
  );
};
