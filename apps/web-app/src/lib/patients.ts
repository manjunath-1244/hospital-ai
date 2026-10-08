import { apiFetch } from './api';
import type { Patient, PatientList } from './types';
import type { VisitSummary } from './visits';

export interface PatientRef { id: string; name: string; visit?: VisitSummary | null }

/**
 * Resolve patient names for a set of ids without an N+1 storm: one list call (up to 200),
 * then single lookups only for ids the list did not contain.
 */
export async function resolvePatientNames(ids: string[]): Promise<Map<string, PatientRef>> {
  const out = new Map<string, PatientRef>();
  const wanted = Array.from(new Set(ids.filter(Boolean)));
  if (wanted.length === 0) return out;
  try {
    const r = await apiFetch<PatientList>('/hospital/patients?limit=200');
    for (const p of r.items) out.set(p.id, { id: p.id, name: p.name, visit: p.visit });
  } catch {
    /* fall through to single lookups */
  }
  const missing = wanted.filter((id) => !out.has(id));
  await Promise.all(
    missing.map(async (id) => {
      try {
        const p = await apiFetch<Patient>(`/hospital/patients/${encodeURIComponent(id)}`);
        out.set(id, { id: p.id, name: p.name, visit: p.visit });
      } catch {
        /* leave unresolved: callers show the id only */
      }
    }),
  );
  return out;
}
