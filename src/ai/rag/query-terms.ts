import type { DocType } from './doc-meta';

const STOPWORDS = new Set(
  'a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my no not of on or our please should so than that the their them then there these they this to us was we were what when where which who whom whose why will with would you your tell show give about need want know'.split(
    ' ',
  ),
);

/** Words of a question that carry meaning (lower-case, no stopwords, no 1-2 letter tokens). */
export function meaningfulTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const t of query.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    if (t.length > 2 && !STOPWORDS.has(t)) seen.add(t);
  return [...seen];
}

/**
 * PostgreSQL `to_tsquery` text that matches a chunk containing ANY of the meaningful words (ranked by how many).
 * (`plainto_tsquery` needs EVERY word, including "who" and "it", so a natural question matched nothing.)
 */
export function toOrTsQuery(query: string): string {
  return meaningfulTerms(query).join(' | ');
}

/**
 * What kind of document the question is most likely about, from the SHAPE of the question (not from its topic):
 *  - "who handles / who is responsible / what is the process" -> policies and SOPs
 *  - "criteria / when to refer / indications / dose" -> clinical guidelines
 * Returned as a preference (a boost), never a filter, so a good match in another type can still win.
 */
export function preferredDocTypes(query: string): DocType[] {
  const q = query.toLowerCase();
  const ownership =
    /\b(who|whom|whose)\b|\b(responsible|handles?|handled|handling|in charge|process|procedure|workflow|routed?|routing|escalat\w*|notify|notified|approval|approve[sd]?|sign[- ]?off|authori[sz]\w*|permission|allowed)\b/.test(
      q,
    );
  const clinical =
    /\b(criteria|criterion|indications?|contraindicat\w*|when (should|to|do)|threshold|symptoms?|dos(e|es|age)|which drug|first[- ]line|referral criteria|red flags?)\b/.test(
      q,
    );
  if (ownership && !clinical) return ['policy', 'sop'];
  if (clinical && !ownership) return ['guideline'];
  return [];
}
