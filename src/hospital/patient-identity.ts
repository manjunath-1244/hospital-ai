/** Age and date-of-birth rules for registration. Pure so they are trivially testable. */
export interface BirthInput {
  age?: number;
  /** Real date of birth, `YYYY-MM-DD`. */
  dob?: string | null;
}
export interface ResolvedBirth {
  age: number;
  dob: string;
  /** true when `dob` was derived from the age (we only know the year); false when a real date of birth was given. */
  dobApproximate: boolean;
}

export function ageFromDob(dob: string, now: Date = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number);
  let age = now.getUTCFullYear() - y;
  if (
    now.getUTCMonth() + 1 < m ||
    (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)
  )
    age -= 1;
  return age;
}

/**
 * A real date of birth wins and makes the age exact. Without one, the age is kept and the birth date is approximated
 * as 1 January of (this year − age), flagged `dobApproximate` so nothing treats it as a real date.
 */
export function resolveBirth(
  input: BirthInput,
  now: Date = new Date(),
): ResolvedBirth {
  if (input.dob) {
    const parsed = new Date(`${input.dob}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime()) {
      throw new RangeError(
        'Date of birth must be a valid date that is not in the future.',
      );
    }
    const age = ageFromDob(input.dob, now);
    if (age > 130) throw new RangeError('Date of birth is implausible.');
    return { age, dob: input.dob, dobApproximate: false };
  }
  if (input.age === undefined || input.age === null)
    throw new RangeError('Either an age or a date of birth is required.');
  return {
    age: input.age,
    dob: `${now.getUTCFullYear() - input.age}-01-01`,
    dobApproximate: true,
  };
}
