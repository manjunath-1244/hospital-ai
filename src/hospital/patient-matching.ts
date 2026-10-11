/**
 * ============================================================================
 * 🧬 CONCEPT: Patient Identity Resolution & De-duplication
 * ============================================================================
 * WHAT IT IS:
 * Deterministic patient matching and de-duplication engine that identifies existing
 * electronic medical records (EMR) during patient registration and clinical encounters.
 *
 * HOW IMPLEMENTED:
 * - Multi-Factor Candidate Scoring:
 *   Evaluates Unicode normalized names (`NFKD`), phone number suffixes (>= 7 digits),
 *   and dates of birth (DOB).
 * - Match Strength Stratification:
 *   Classifies match confidence as `HIGH` (name + phone/DOB agree) or `MEDIUM` (single strong signal).
 * - Non-Blocking Advice:
 *   Presents candidate duplicates to receptionists for visual confirmation rather than
 *   silently blocking registrations or creating duplicate medical records.
 *
 * USE CASE:
 * Prevents split medical records, ensuring a patient's historical diagnoses,
 * allergies, and prescriptions are consolidated under a single medical identity.
 * ============================================================================
 * Duplicate detection when registering a patient. Pure functions so the rules are easy to read and test.
 * A "match" is advice for the receptionist (show it, let them decide); it never blocks silently.
 */
export interface MatchCandidate {
  id: string;
  name: string;
  phone: string;
  dob: string;
  dobApproximate: boolean;
}
export interface MatchInput {
  name: string;
  phone: string;
  /** Real date of birth if the receptionist captured one. */
  dob?: string | null;
}
export type MatchReason = 'SAME_NAME' | 'SAME_PHONE' | 'SAME_DOB';
export interface PossibleMatch {
  patientId: string;
  reasons: MatchReason[];
  /** HIGH = name and phone agree (almost certainly the same person); MEDIUM = one strong signal. */
  strength: 'HIGH' | 'MEDIUM';
}

export const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Digits only. */
export const normalizePhone = (phone: string): string =>
  phone.replace(/\D/g, '');

/**
 * Two numbers are the same if one ends with the other (a country code may be present on only one) and the shared
 * part is at least 7 digits (shorter numbers are not comparable).
 */
export function phonesMatch(a: string, b: string): boolean {
  const da = normalizePhone(a);
  const db = normalizePhone(b);
  if (Math.min(da.length, db.length) < 7) return false;
  return da.endsWith(db) || db.endsWith(da);
}

export function scoreMatch(
  candidate: MatchCandidate,
  input: MatchInput,
): PossibleMatch | null {
  const reasons: MatchReason[] = [];
  const name = normalizeName(input.name);
  if (name && name === normalizeName(candidate.name)) reasons.push('SAME_NAME');
  if (phonesMatch(input.phone, candidate.phone)) reasons.push('SAME_PHONE');
  if (input.dob && !candidate.dobApproximate && input.dob === candidate.dob)
    reasons.push('SAME_DOB');

  const hasName = reasons.includes('SAME_NAME');
  const hasPhone = reasons.includes('SAME_PHONE');
  const hasDob = reasons.includes('SAME_DOB');
  if (hasName && (hasPhone || hasDob))
    return { patientId: candidate.id, reasons, strength: 'HIGH' };
  if (hasName || hasPhone)
    return { patientId: candidate.id, reasons, strength: 'MEDIUM' };
  return null;
}

export function rankMatches(
  candidates: MatchCandidate[],
  input: MatchInput,
): PossibleMatch[] {
  return candidates
    .map((c) => scoreMatch(c, input))
    .filter((m): m is PossibleMatch => m !== null)
    .sort((a, b) =>
      a.strength === b.strength
        ? b.reasons.length - a.reasons.length
        : a.strength === 'HIGH'
          ? -1
          : 1,
    );
}
