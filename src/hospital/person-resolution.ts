import { editDistance, allowedTypos, NAME_STOPWORDS } from './mention-matching';

export interface Person {
  kind: 'PATIENT' | 'STAFF';
  id: string;
  /** As stored, e.g. "Dr. Sarah Wilson (Cardiology)". */
  name: string;
}

export interface PersonMatch {
  person: Person;
  /** The words the user typed that were matched with a typo (empty when every word was exact). */
  typed: string[];
  /** How many of the person's name words the message accounts for. */
  words: number;
}

export interface Resolution {
  /** NONE: nobody; EXACT: the name as typed; CORRECTED: only with typos; AMBIGUOUS: several equally close people. */
  status: 'NONE' | 'EXACT' | 'CORRECTED' | 'AMBIGUOUS';
  matches: PersonMatch[];
}

const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'prof']);
const MIN_WORD = 4;

/** The words of a stored name that identify a person (no titles, no "(Cardiology)" suffix). */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !TITLES.has(w));
}

/**
 * Who a message is about, over patients AND staff in one pass. Each person is scored by how many of THEIR name words the
 * message accounts for (exactly, or within the typing allowance). The highest score wins when it is clearly ahead;
 * equally close people are all returned so the caller asks instead of guessing. Ordinary words never count
 * (`NAME_STOPWORDS`), and short words (under 4 letters) only count as part of a full-name match.
 */
export function resolvePeople(message: string, people: Person[]): Resolution {
  const text = message.toLowerCase();
  const tokens = [...new Set(text.match(/[a-z]{3,}/g) ?? [])].filter(
    (t) => !NAME_STOPWORDS.has(t),
  );
  const rows: Array<{
    match: PersonMatch;
    dist: number;
    coverage: number;
    full: boolean;
  }> = [];

  for (const person of people) {
    const words = nameWords(person.name);
    if (!words.length) continue;
    const full = new RegExp(
      `(^|[^a-z])${words.join('[^a-z]+')}([^a-z]|$)`,
    ).test(text);
    let matched = 0;
    let dist = 0;
    const typed: string[] = [];
    for (const w of words) {
      if (NAME_STOPWORDS.has(w)) continue;
      let best: { t: string; d: number } | null = null;
      for (const t of tokens) {
        if (t.length < MIN_WORD && !(full && t === w)) continue;
        if (w.length < MIN_WORD && !(full && t === w)) continue;
        const d = t === w ? 0 : editDistance(t, w);
        const allowed =
          t === w ? 0 : allowedTypos(Math.max(t.length, w.length));
        if (d <= allowed && (t === w || t[0] === w[0] || d <= 1))
          if (!best || d < best.d) best = { t, d };
      }
      if (best) {
        matched++;
        dist += best.d;
        if (best.d > 0) typed.push(best.t);
      }
    }
    if (matched)
      rows.push({
        match: { person, typed, words: matched },
        dist,
        coverage: matched / words.length,
        full,
      });
  }
  if (!rows.length) return { status: 'NONE', matches: [] };

  // best first: more of the name accounted for, then the whole name covered, then fewer typos
  rows.sort(
    (a, b) =>
      b.match.words - a.match.words ||
      b.coverage - a.coverage ||
      Number(b.full) - Number(a.full) ||
      a.dist - b.dist,
  );
  const top = rows[0];
  const tied = rows.filter(
    (r) =>
      r.match.words === top.match.words &&
      r.coverage === top.coverage &&
      r.dist === top.dist,
  );
  // With typos, a runner-up only ONE edit further away is still "close": ask rather than pick.
  const near =
    top.dist > 0
      ? rows.filter(
          (r) =>
            r.match.words === top.match.words &&
            r.coverage === top.coverage &&
            r.dist <= top.dist + 1,
        )
      : tied;
  const chosen = near.length > 1 ? near : [top];
  const exact = chosen.every((c) => c.dist === 0);
  // equally close people: identical stored names are the same name twice (return both, as exact); different people are ambiguous
  const sameName =
    new Set(chosen.map((c) => c.match.person.name.toLowerCase())).size === 1;
  const status: Resolution['status'] =
    chosen.length > 1 && !sameName
      ? 'AMBIGUOUS'
      : exact
        ? 'EXACT'
        : 'CORRECTED';
  return { status, matches: chosen.slice(0, 4).map((c) => c.match) };
}
