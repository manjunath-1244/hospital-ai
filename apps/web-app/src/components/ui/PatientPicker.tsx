'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch, errorMessage } from '../../lib/api';
import { useRealtime } from '../../context/RoleContext';
import type { Patient, PatientList } from '../../lib/types';
import { Field, Select } from './kit';

interface Props {
  value: string;
  onChange: (id: string, patient?: Patient) => void;
  label?: string;
  refreshKey?: number;
}

/** Dropdown of patients loaded from GET /hospital/patients. */
export const PatientPicker: React.FC<Props> = ({ value, onChange, label = 'Patient', refreshKey = 0 }) => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [rt, setRt] = useState(0);
  useRealtime(['patient.registered', 'visit.updated', 'patient.deleted'], () => setRt((n) => n + 1));

  useEffect(() => {
    let cancelled = false;
    apiFetch<PatientList>('/hospital/patients?limit=100')
      .then((r) => {
        if (!cancelled) {
          setPatients(r.items);
          setError('');
        }
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey, rt]);

  return (
    <Field label={label} error={error}>
      {(id) => (
        <Select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value, patients.find((p) => p.id === e.target.value))}
          disabled={loading}
          data-testid="patient-picker"
        >
          <option value="">{loading ? 'Loading patients...' : patients.length ? 'Select a patient' : 'No patients found'}</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.id}) — {p.age}y {p.gender}{p.visit ? ` — ${p.visit.statusLabel}` : ' — no visit'}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
};
