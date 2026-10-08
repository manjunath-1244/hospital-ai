/**
 * Which patients does a free-text message refer to? By id ("P1001"), by full name, or by a distinctive first/last name
 * that belongs to exactly one patient. Ambiguous names are skipped rather than guessed. Pure and unit-tested.
 */
export interface Nameable {
  id: string;
  name: string;
}

/**
 * Ordinary words that must never count as part of a patient's name. (A patient literally called "Test Patient" once
 * made every question containing the word "patient" fetch that chart.)
 */
export const NAME_STOPWORDS: ReadonlySet<string> = new Set([
  'patient',
  'patients',
  'test',
  'check',
  'persist',
  'journey',
  'sample',
  'demo',
  'user',
  'name',
  'doctor',
  'nurse',
  'what',
  'when',
  'with',
  'from',
  'that',
  'this',
  'have',
  'been',
  'does',
  'show',
  'list',
  'give',
]);

const MIN_TOKEN = 4;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function findMentionedPatients<T extends Nameable>(
  message: string,
  patients: T[],
  max = 3,
): T[] {
  const text = message.toLowerCase();
  const hits = new Map<string, T>();

  for (const p of patients) {
    if (
      new RegExp(
        `(^|[^a-z0-9])${escape(p.id.toLowerCase())}([^a-z0-9]|$)`,
      ).test(text)
    )
      hits.set(p.id, p);
  }
  const named = patients.filter((p) => text.includes(p.name.toLowerCase()));
  named.forEach((p) => hits.set(p.id, p));

  if (!named.length) {
    const owners = new Map<string, T[]>();
    for (const p of patients) {
      for (const token of p.name.toLowerCase().split(/\s+/)) {
        if (token.length >= MIN_TOKEN && !NAME_STOPWORDS.has(token))
          owners.set(token, [...(owners.get(token) ?? []), p]);
      }
    }
    for (const [token, who] of owners) {
      if (
        who.length === 1 &&
        new RegExp(`(^|[^a-z])${escape(token)}([^a-z]|$)`).test(text)
      )
        hits.set(who[0].id, who[0]);
    }
  }
  return [...hits.values()].slice(0, max);
}
