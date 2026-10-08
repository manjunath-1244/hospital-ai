'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, Upload } from 'lucide-react';
import { apiFetch, apiFetchBlobUrl, errorMessage } from '../../lib/api';
import type { Patient, ImagingStudy, ImagingUploadResponse } from '../../lib/types';
import { Empty, ErrorBox, Loading, SuccessBox, fmtTime, inputCls, labelCls } from '../ui/common';
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
      <div className="rounded-2xl glass-panel p-7 border-l-4 border-l-cyan-500">
        <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <Radio className="h-8 w-8 text-cyan-400" />
          Radiology: DICOM Studies & Lab Results
        </h2>
        <p className="text-base text-slate-300 mt-1.5">Upload .dcm files, review studies per patient, and record lab results.</p>
      </div>

      <div className="glass-panel p-7 rounded-2xl border border-slate-700 max-w-2xl">
        <PatientPicker value={patientId} onChange={changePatient} />
        {patientClosed && <p className="mt-2 text-sm font-semibold text-rose-400">Patient has no open visit: uploads and lab entry are disabled.</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <form onSubmit={upload} className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
            <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2 border-b border-slate-700 pb-4">
              <Upload className="h-5 w-5 text-cyan-400" /> Upload DICOM Study
            </h3>
            <div>
              <label className={labelCls}>DICOM file (.dcm) *</label>
              <input ref={fileRef} type="file" accept=".dcm,application/dicom" required className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Impression</label>
              <textarea rows={2} value={impression} onChange={(e) => setImpression(e.target.value)} className={inputCls} />
            </div>
            <ErrorBox message={uploadError} />
            <SuccessBox message={uploadMsg} />
            <button type="submit" disabled={uploading || !patientId || patientClosed} className="w-full rounded-xl bg-cyan-600 py-3 text-base font-bold text-white hover:bg-cyan-500 disabled:opacity-50">
              {uploading ? 'Uploading...' : 'Upload study'}
            </button>
          </form>

          <LabResultForm patientId={patientId} open={!!patientId && !patientClosed} accent="bg-cyan-600 hover:bg-cyan-500" />
        </div>

        <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
          <h3 className="text-xl font-semibold text-white tracking-tight border-b border-slate-700 pb-4">Studies</h3>
          {!patientId && <Empty text="Select a patient to list their studies." />}
          {studiesLoading && <Loading text="Loading studies..." />}
          <ErrorBox message={studiesError} />
          {patientId && !studiesLoading && !studiesError && studies.length === 0 && <Empty text="No imaging studies for this patient." />}
          <div className="space-y-2">
            {studies.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedStudy(s)}
                className={`w-full text-left rounded-xl border p-3 text-sm ${selectedStudy?.id === s.id ? 'bg-cyan-600/20 border-cyan-400' : 'bg-slate-950 border-slate-800 hover:border-slate-600'}`}
              >
                <p className="font-bold text-white">{s.modality} — {s.description}</p>
                <p className="text-sm text-slate-400">{fmtTime(s.studyDate ?? s.createdAt)} • uploaded by {s.uploadedBy}{s.hasPreview ? '' : ' • no preview'}</p>
              </button>
            ))}
          </div>

          {selectedStudy && (
            <div className="space-y-3 border-t border-slate-800 pt-4">
              <p className="text-sm font-mono text-slate-500 break-all">UID {selectedStudy.studyInstanceUid}</p>
              {selectedStudy.rows && selectedStudy.columns && <p className="text-sm text-slate-400">{selectedStudy.columns} x {selectedStudy.rows}</p>}
              {selectedStudy.impression && <p className="text-sm text-slate-200">Impression: {selectedStudy.impression}</p>}
              {previewLoading && <Loading text="Loading preview..." />}
              <ErrorBox message={previewError} />
              {!selectedStudy.hasPreview && <Empty text="No preview available for this study." />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {previewUrl && <img src={previewUrl} alt={`${selectedStudy.modality} preview`} className="max-h-96 w-full object-contain rounded-xl bg-black border border-slate-700" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
