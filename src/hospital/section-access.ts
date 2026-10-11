import type { UserRole } from '../security/roles.decorator';

/**
 * ============================================================================
 * 🔒 CONCEPT: HIPAA Minimum Necessary Rule & Field-Level Access Matrix
 * ============================================================================
 * WHAT IT IS:
 * Granular clinical authorization engine enforcing the HIPAA 45 CFR § 164.502(b)
 * "Minimum Necessary" standard across patient electronic health records.
 *
 * HOW IMPLEMENTED:
 * - Deterministic Section Access Matrix (`SECTION_ACCESS`):
 *   Maps clinical chart sections (`conditions`, `allergies`, `medications`) to authorized
 *   hospital roles (e.g. pharmacists see medications & allergies; receptionists see neither).
 * - Single Source of Authorization Truth:
 *   Used symmetrically across both REST API endpoints and AI agent summary generation,
 *   guaranteeing that AI prompts and API responses enforce identical data boundaries.
 *
 * USE CASE:
 * Prevents over-exposure of sensitive patient diagnoses to administrative or non-clinical
 * hospital personnel, ensuring strict compliance with medical confidentiality laws.
 * ============================================================================
 * Minimum necessary: which roles may see which clinical parts of a patient. One table used by the chart summary (what
 * the agent and the chart screens show) AND by the patient endpoints, so the two can never disagree.
 */
export const SECTION_ACCESS: Record<
  'conditions' | 'allergies' | 'medications',
  readonly UserRole[]
> = {
  conditions: [
    'DOCTOR',
    'NURSE',
    'ADMIN',
    'PHARMACIST',
    'RADIOLOGIST',
    'CARE_COORDINATOR',
    'SPECIALIST',
  ],
  allergies: [
    'DOCTOR',
    'NURSE',
    'ADMIN',
    'PHARMACIST',
    'RADIOLOGIST',
    'SPECIALIST',
  ],
  medications: [
    'DOCTOR',
    'NURSE',
    'ADMIN',
    'PHARMACIST',
    'CARE_COORDINATOR',
    'SPECIALIST',
  ],
};

export const mayRead = (
  role: UserRole,
  section: keyof typeof SECTION_ACCESS,
): boolean => SECTION_ACCESS[section].includes(role);
