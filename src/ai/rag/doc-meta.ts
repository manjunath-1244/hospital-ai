/** What kind of document a chunk comes from. Policies/SOPs say WHO does WHAT; guidelines say WHEN and WHY clinically. */
export const DOC_TYPES = ['policy', 'sop', 'guideline'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface DocMeta {
  docType: DocType;
  /** Human title of the document (first heading, or the front-matter title). */
  title: string;
}

/**
 * Optional `---` front matter at the top of a markdown file (`docType: guideline`, `title: ...`). The body is returned
 * without it so it is never indexed as content.
 */
export function parseFrontMatter(text: string): {
  meta: Partial<Record<'docType' | 'title', string>>;
  body: string;
} {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta: Partial<Record<'docType' | 'title', string>> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(docType|title)\s*:\s*(.+?)\s*$/i);
    if (kv)
      meta[kv[1].toLowerCase() === 'doctype' ? 'docType' : 'title'] = kv[2];
  }
  return { meta, body: text.slice(m[0].length) };
}

export function asDocType(
  value: unknown,
  fallback: DocType = 'policy',
): DocType {
  const v = String(value ?? '').toLowerCase();
  return (DOC_TYPES as readonly string[]).includes(v)
    ? (v as DocType)
    : fallback;
}

/** First markdown heading of a document, used as its title when none is given. */
export function firstHeading(body: string, fallback: string): string {
  const h = body.match(/^\s*#{1,3}\s+(.+)$/m);
  return (
    (h ? h[1] : fallback).replace(/[^\p{L}\p{N}&/ ,.()'-]/gu, '').trim() ||
    fallback
  );
}

/**
 * The text that is EMBEDDED for a chunk: the document title, its type and the section heading travel with the content,
 * so a bare bullet list still knows what it is about ("Appointment policy / Booking rules / Urgent consultations...").
 */
export function embeddingText(
  meta: DocMeta,
  heading: string,
  content: string,
): string {
  return `${meta.title} (${meta.docType}) - ${heading}\n${content}`;
}
