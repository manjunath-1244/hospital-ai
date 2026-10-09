export interface StaffOut {
  byRole: Record<
    string,
    Array<{
      id?: string;
      name: string;
      specialty: string | null;
      isAvailable: boolean;
    }>
  >;
}

const ROLE_WORDS: Array<[string, RegExp, string]> = [
  ['DOCTOR', /\b(doctors?|physicians?)\b/i, 'doctor'],
  ['NURSE', /\bnurses?\b/i, 'nurse'],
  ['PHARMACIST', /\bpharmacists?\b/i, 'pharmacist'],
  ['RADIOLOGIST', /\bradiologists?\b/i, 'radiologist'],
  ['RECEPTIONIST', /\breceptionists?\b/i, 'receptionist'],
  ['CARE_COORDINATOR', /\bcoordinators?\b/i, 'care coordinator'],
];

/** Staff counts and names straight from the accounts (names of staff are not patient data). */
export function renderStaff(out: StaffOut, message: string): string {
  const asked = ROLE_WORDS.filter(([, re]) => re.test(message));
  const roles = asked.length ? asked : ROLE_WORDS;
  const lines = roles.map(([role, , label]) => {
    const people = out.byRole[role] ?? [];
    if (asked.length === 1)
      return people.length
        ? `There ${people.length === 1 ? 'is' : 'are'} ${people.length} ${label}${people.length === 1 ? '' : 's'}:\n${people.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}`
        : `There are no ${label}s on record.`;
    return `• ${label}s: ${people.length}${people.length ? ` (${people.map((p) => p.name).join(', ')})` : ''}`;
  });
  return asked.length === 1 ? lines[0] : `Staff accounts:\n${lines.join('\n')}`;
}
