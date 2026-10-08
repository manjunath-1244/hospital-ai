/** Deterministic answer about the specialists: the count and every name come straight from the staff data. */
export function renderSpecialists(out: {
  specialty?: string;
  specialists: Array<{
    name: string;
    specialty: string | null;
    isAvailable: boolean;
  }>;
}): string {
  const list = out.specialists ?? [];
  const what = out.specialty ? `${out.specialty} specialist` : 'specialist';
  if (!list.length) return `There are no ${what}s on record.`;
  const lines = list.map(
    (s) =>
      `${list.indexOf(s) + 1}. ${s.name}${s.specialty && !out.specialty ? ` — ${s.specialty}` : ''} (${s.isAvailable ? 'available for bookings' : 'not available'})`,
  );
  return `There ${list.length === 1 ? 'is' : 'are'} ${list.length} ${what}${list.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
}
