import type { UserRole } from '../security/roles.decorator';

/**
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
