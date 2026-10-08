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

/** Edit distance counting a swap of two neighbouring letters as one edit (typical typing slips). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** How many typing mistakes a name word of this length may contain: none for short words, 1 for 5, 2 from 6 letters. */
export const allowedTypos = (len: number): number =>
  len < 5 ? 0 : len < 6 ? 1 : 2;

export interface FuzzyMatch<T> {
  patient: T;
  /** The word the user typed. */
  typed: string;
  /** The name word it was matched to. */
  matchedWord: string;
}

/**
 * Typos in names ("James Mllelr" for "James Miller"). Used only when nothing matched exactly. Each word of the message
 * is compared with each name word; a patient matches when a word is within the allowed number of typing mistakes and no
 * other patient is just as close (ambiguity is returned as several matches so the caller can ask, never guessed).
 */
export function findFuzzyPatients<T extends Nameable>(
  message: string,
  patients: T[],
): FuzzyMatch<T>[] {
  const words = [
    ...new Set(
      (message.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(
        (w) => !NAME_STOPWORDS.has(w),
      ),
    ),
  ];
  const best = new Map<string, FuzzyMatch<T> & { dist: number }>();
  for (const typed of words) {
    for (const p of patients) {
      for (const word of p.name.toLowerCase().split(/\s+/)) {
        if (word.length < 5 || NAME_STOPWORDS.has(word) || word === typed)
          continue;
        // a 4-letter slip ("Sarh") must still start like the name; longer words are judged by edits alone
        if (typed.length < 5 && typed[0] !== word[0]) continue;
        const dist = editDistance(typed, word);
        if (
          dist === 0 ||
          dist > allowedTypos(Math.max(typed.length, word.length))
        )
          continue;
        const prev = best.get(p.id);
        if (!prev || dist < prev.dist)
          best.set(p.id, { patient: p, typed, matchedWord: word, dist });
      }
    }
  }
  const all = [...best.values()].sort((a, b) => a.dist - b.dist);
  if (!all.length) return [];
  // Keep only the closest candidates; several of them = ambiguous.
  return all
    .filter((m) => m.dist === all[0].dist)
    .map(({ dist: _d, ...m }) => m);
}
