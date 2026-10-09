'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, Upload } from 'lucide-react';
import { apiFetch, apiFetchBlobUrl, errorMessage } from '../../lib/api';
import type { Patient, ImagingStudy, ImagingUploadResponse } from '../../lib/types';
import { ErrorBox, Loading, SuccessBox, fmtTime } from '../ui/common';
import { Alert, Button, Card, EmptyState, Field, PageHeader, SectionTitle, Textarea, cx, fieldInputCls } from '../ui/kit';
import { isActiveStatus } from '../../lib/visits';
import { LabResultForm } from '../ui/LabResultForm';
import { PatientPicker } from '../ui/PatientPicker';
import { useRealtime } from '../../context/RoleContext';

export const RadiologyPortal: React.FC = () => {
  const [patientId, setPatientId] = useState('');
  const [patientClosed, setPatientClosed] = useState(false);
  const [studies, setStudies] = useState<ImagingStudy[]>([]);
  const [studiesLoading, setStudiesLoading] = useState(false);
  const [studiesError, setStudiesError] = useState('');
  const [selectedStudy, setSelectedStudy] = useState<ImagingStudy | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const [impression, setImpression] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');

  const loadStudies = useCallback(async (id: string) => {
    if (!id) {
      setStudies([]);
      return;
    }
    setStudiesLoading(true);
    try {
      setStudies(await apiFetch<ImagingStudy[]>(`/hospital/patients/${encodeURIComponent(id)}/imaging`));
      setStudiesError('');
    } catch (e) {
      setStudiesError(errorMessage(e));
    } finally {
      setStudiesLoading(false);
    }
  }, []);

  const changePatient = (id: string, p?: Patient) => {
    setPatientId(id);
    setPatientClosed(!!id && !isActiveStatus(p?.visit?.status));
    setSelectedStudy(null);
    setStudies([]);
    loadStudies(id);
  };

  useRealtime(['dicom.uploaded'], () => loadStudies(patientId));

  // Authenticated preview fetch as blob
  useEffect(() => {
    if (!selectedStudy || !selectedStudy.hasPreview) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    apiFetchBlobUrl(`/hospital/imaging/${encodeURIComponent(selectedStudy.id)}/preview`)
      .then((u) => {
        if (cancelled) URL.revokeObjectURL(u);
        else {
          url = u;
          setPreviewUrl(u);
        }
      })
      .catch((e) => !cancelled && (setPreviewUrl(null), setPreviewError(errorMessage(e))))
      .finally(() => !cancelled && setPreviewLoading(false));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [selectedStudy]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !patientId) return;
    setUploading(true);
    setUploadError('');
    setUploadMsg('');
    try {
      const fd = new FormData();
      fd.append('patientId', patientId);
      if (impression.trim()) fd.append('impression', impression.trim());
      fd.append('file', file);
      const res = await apiFetch<ImagingUploadResponse>('/hospital/lifecycle/imaging-study', { method: 'POST', formData: fd });
      setUploadMsg(`Study ${res.study.id} stored. Orthanc stored: ${res.orthancStored ? 'yes' : 'no'}; FHIR synced: ${res.fhirSynced ? 'yes' : 'no'}.`);
      setImpression('');
      if (fileRef.current) fileRef.current.value = '';
      loadStudies(patientId);
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Radio className="h-6 w-6" />}
        title="Radiology: DICOM Studies & Lab Results"
        subtitle="Upload .dcm files, review studies per patient, and record lab results."
      />

      <Card className="max-w-2xl">
        <PatientPicker value={patientId} onChange={changePatient} />
        {patientClosed && (
          <div className="mt-3">
            <Alert tone="warning">Patient has no open visit: uploads and lab entry are disabled.</Alert>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card as="div">
            <form onSubmit={upload} className="space-y-4">
              <SectionTitle icon={<Upload className="h-5 w-5" />} className="!mb-0">Upload DICOM Study</SectionTitle>
              <Field label="DICOM file (.dcm) *">
                {(id) => <input id={id} ref={fileRef} type="file" accept=".dcm,application/dicom" required className={fieldInputCls} />}
              </Field>
              <Field label="Impression">
                {(id) => <Textarea id={id} rows={2} value={impression} onChange={(e) => setImpression(e.target.value)} />}
              </Field>
              <ErrorBox message={uploadError} />
              <SuccessBox message={uploadMsg} />
              <Button type="submit" loading={uploading} disabled={uploading || !patientId || patientClosed} className="w-full" data-testid="dicom-upload-submit">
                {uploading ? 'Uploading...' : 'Upload study'}
              </Button>
            </form>
          </Card>

          <LabResultForm patientId={patientId} open={!!patientId && !patientClosed} />
        </div>

        <Card className="space-y-4">
          <SectionTitle className="!mb-0">Studies</SectionTitle>
          {!patientId && <EmptyState title="Select a patient to list their studies." />}
          {studiesLoading && <Loading text="Loading studies..." />}
          <ErrorBox message={studiesError} />
          {patientId && !studiesLoading && !studiesError && studies.length === 0 && (
            <EmptyState title="No imaging studies for this patient." hint="Uploaded studies appear here." />
          )}
          <div className="space-y-2">
            {studies.map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid="imaging-study-item"
                aria-pressed={selectedStudy?.id === s.id}
                onClick={() => setSelectedStudy(s)}
                className={cx(
                  'min-h-11 w-full rounded-lg border p-3 text-left text-sm',
                  selectedStudy?.id === s.id ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface hover:bg-surface-muted',
                )}
              >
                <p className="font-semibold text-ink">{s.modality} — {s.description}</p>
                <p className="text-sm text-ink-3">{fmtTime(s.studyDate ?? s.createdAt)} • uploaded by {s.uploadedBy}{s.hasPreview ? '' : ' • no preview'}</p>
              </button>
            ))}
          </div>

          {selectedStudy && (
            <div className="space-y-3 border-t border-line pt-4">
              <p className="break-all font-mono text-sm text-ink-3">UID {selectedStudy.studyInstanceUid}</p>
              {selectedStudy.rows && selectedStudy.columns && <p className="text-sm text-ink-3">{selectedStudy.columns} x {selectedStudy.rows}</p>}
              {selectedStudy.impression && <p className="text-sm text-ink">Impression: {selectedStudy.impression}</p>}
              {previewLoading && <Loading text="Loading preview..." />}
              <ErrorBox message={previewError} />
              {!selectedStudy.hasPreview && <EmptyState title="No preview available for this study." />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {previewUrl && <img src={previewUrl} alt={`${selectedStudy.modality} preview`} className="max-h-96 w-full rounded-lg border border-line bg-ink object-contain" />}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
