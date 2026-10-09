import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EmbeddingProvider } from './embedding.provider';
import {
  asDocType,
  DocMeta,
  DocType,
  embeddingText,
  firstHeading,
  parseFrontMatter,
} from './doc-meta';
import { preferredDocTypes } from './query-terms';
import {
  DocKind,
  SearchHit,
  StoredChunk,
  VectorStore,
} from './pgvector-rag.service';

export interface RagRecord {
  /** Stable source key, e.g. `consultation-CON-AB12`; re-ingesting the same key updates in place. */
  source: string;
  heading: string;
  text: string;
  kind: DocKind;
  patientId?: string;
  /** For documents: policy | sop | guideline (front matter `docType:` wins). Default policy. */
  docType?: DocType;
}

export interface PolicySearchOptions {
  /** Only these document types. */
  docTypes?: DocType[];
  /** Rank bonus for these types; by default derived from the shape of the question (who handles -> policy/SOP). */
  preferDocTypes?: DocType[];
  /** Keep only hits whose cosine similarity to the question is at least this (0-1). */
  minSimilarity?: number;
}

/** Single RAG entry point: chunking + embedding + storage. Policies and patient records share one store. */
@Injectable()
export class VectorRagService implements OnModuleInit {
  private readonly logger = new Logger(VectorRagService.name);

  constructor(
    private readonly store: VectorStore,
    private readonly embedder: EmbeddingProvider,
  ) {}

  async onModuleInit() {
    await this.indexKnowledgeBase();
  }

  /** (Re)indexes /knowledge/*.md. Unchanged chunks are skipped, so restarts are cheap. */
  async indexKnowledgeBase(dir = path.join(process.cwd(), 'knowledge')) {
    if (!fs.existsSync(dir)) {
      this.logger.warn(`Knowledge directory not found: ${dir}`);
      return;
    }
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      await this.ingest({
        source: file,
        heading: file,
        text: fs.readFileSync(path.join(dir, file), 'utf-8'),
        kind: 'policy',
      });
    }
    this.logger.log(
      `Knowledge base indexed; ${await this.store.count()} chunks in vector store.`,
    );
  }

  async ingest(rec: RagRecord): Promise<number> {
    // Documents carry their type and title with every chunk; patient records are indexed as they are.
    let text = rec.text;
    let docMeta: DocMeta | null = null;
    if (rec.kind === 'policy') {
      const fm = parseFrontMatter(rec.text);
      text = fm.body;
      docMeta = {
        docType: asDocType(fm.meta.docType ?? rec.docType),
        title: fm.meta.title ?? firstHeading(text, rec.heading),
      };
    }
    const pieces = this.chunk(text, rec.heading);
    const rows = pieces.map((p, i) => {
      const embedText = docMeta
        ? embeddingText(docMeta, p.heading, p.content)
        : p.content;
      return {
        id: `${rec.source}#${i}`,
        heading: p.heading,
        content: p.content,
        embedText,
        contentHash: createHash('sha256')
          .update(`${this.embedder.modelId}\n${embedText}`)
          .digest('hex'),
      };
    });

    const existing = await this.store.getHashes(rec.source);
    const changed = rows.filter((r) => existing.get(r.id) !== r.contentHash);
    if (changed.length) {
      const vectors = await this.embedder.embed(
        changed.map((c) => c.embedText),
      );
      const chunks: StoredChunk[] = changed.map((c, i) => ({
        id: c.id,
        source: rec.source,
        kind: rec.kind,
        patientId: rec.patientId ? rec.patientId.toUpperCase() : null,
        heading: c.heading,
        content: c.content,
        contentHash: c.contentHash,
        embedding: vectors[i],
        metadata: docMeta
          ? { docType: docMeta.docType, title: docMeta.title }
          : {},
      }));
      await this.store.upsert(chunks);
    }
    await this.store.deleteExcept(
      rec.source,
      rows.map((r) => r.id),
    );
    return changed.length;
  }

  removePatient(patientId: string) {
    return this.store.deleteByPatient(patientId);
  }

  removeSource(source: string) {
    return this.store.deleteBySource(source);
  }

  chunkCountForSource(source: string) {
    return this.store.countBySource(source);
  }

  // Query embeddings are deterministic, so repeated questions skip the embedding call. (Answers are NOT cached:
  // patient data must always be fresh.) Small LRU with a TTL.
  private readonly queryCache = new Map<
    string,
    { vec: number[]; at: number }
  >();

  private async embedQueryCached(query: string): Promise<number[]> {
    const key = query.trim().toLowerCase();
    const hit = this.queryCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) {
      this.queryCache.delete(key);
      this.queryCache.set(key, hit); // refresh recency
      return hit.vec;
    }
    const vec = await this.embedder.embedQuery(query);
    this.queryCache.set(key, { vec, at: Date.now() });
    if (this.queryCache.size > 500)
      this.queryCache.delete(this.queryCache.keys().next().value as string);
    return vec;
  }

  /**
   * THE search over hospital documents (policies, SOPs, guidelines): hybrid vector + keyword, with a document-type
   * preference taken from the shape of the question. Every tool, the referral engine and the retrieval checks use it.
   */
  async searchPolicies(
    query: string,
    topK = 4,
    opts: PolicySearchOptions = {},
  ): Promise<SearchHit[]> {
    const vec = await this.embedQueryCached(query);
    const hits = await this.store.searchHybrid(query, vec, {
      topK: opts.minSimilarity ? Math.max(topK * 3, 12) : topK,
      kind: 'policy',
      docTypes: opts.docTypes,
      preferDocTypes: opts.preferDocTypes ?? preferredDocTypes(query),
    });
    const kept = opts.minSimilarity
      ? hits.filter((h) => (h.similarity ?? 0) >= opts.minSimilarity!)
      : hits;
    return kept.slice(0, topK);
  }

  /** Dense-only search, kept for diagnostics and comparisons; production code uses `searchPolicies`. */
  async searchPoliciesDense(query: string, topK = 4): Promise<SearchHit[]> {
    return this.store.search(await this.embedQueryCached(query), {
      topK,
      kind: 'policy',
    });
  }

  /** Patient-record search (one patient or all), hybrid like policies: exact drug names and numbers match by keyword. */
  async searchPatientRecords(
    query: string,
    patientId: string | undefined,
    topK = 4,
  ): Promise<SearchHit[]> {
    const vec = await this.embedQueryCached(query);
    return this.store.searchHybrid(query, vec, {
      topK,
      kind: 'patient_record',
      patientId,
    });
  }

  /** Reformulates conversational follow-up queries using context summary. */
  rewriteQuery(query: string, conversationSummary?: string): string {
    const trimmed = query.trim();
    if (!conversationSummary) return trimmed;
    const hasPronouns =
      /\b(he|him|his|she|her|hers|it|its|they|them|their|those|these|that|this)\b/i.test(
        trimmed,
      );
    if (hasPronouns) {
      return `${conversationSummary.slice(0, 150)} ${trimmed}`.trim();
    }
    return trimmed;
  }

  /** Reranks search hits using keyword matching and score weighting. */
  rerank(query: string, hits: SearchHit[]): SearchHit[] {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);
    if (!terms.length) return hits;

    return [...hits].sort((a, b) => {
      const aText = `${a.heading} ${a.content}`.toLowerCase();
      const bText = `${b.heading} ${b.content}`.toLowerCase();
      const aExactMatches = terms.filter((t) => aText.includes(t)).length;
      const bExactMatches = terms.filter((t) => bText.includes(t)).length;

      const aScore = a.score + aExactMatches * 0.1;
      const bScore = b.score + bExactMatches * 0.1;
      return bScore - aScore;
    });
  }

  /** Truncates context chunks to stay within character budgets while preserving citations. */
  compressContext(hits: SearchHit[], maxChars = 3000): SearchHit[] {
    const result: SearchHit[] = [];
    let totalLen = 0;
    for (const hit of hits) {
      if (totalLen >= maxChars) break;
      const remaining = maxChars - totalLen;
      if (hit.content.length <= remaining) {
        result.push(hit);
        totalLen += hit.content.length;
      } else {
        result.push({
          ...hit,
          content: hit.content.slice(0, remaining) + '...',
        });
        totalLen += remaining;
        break;
      }
    }
    return result;
  }

  /** Split on markdown headings, then on paragraphs with a size cap, keeping the section heading on each chunk. */
  private chunk(
    text: string,
    fallbackHeading: string,
    maxLen = 1000,
  ): Array<{ heading: string; content: string }> {
    const out: Array<{ heading: string; content: string }> = [];
    const sections = text.split(/\n(?=#{1,3}\s)/);
    for (const sec of sections) {
      const trimmed = sec.trim();
      if (trimmed.length < 20) continue;
      const heading =
        trimmed
          .split('\n')[0]
          .replace(/^#+\s*/, '')
          .trim() || fallbackHeading;
      if (trimmed.length <= maxLen) {
        out.push({ heading, content: trimmed });
        continue;
      }
      let buf = '';
      for (const para of trimmed.split(/\n{1,2}/)) {
        if (buf && buf.length + para.length > maxLen) {
          out.push({ heading, content: buf.trim() });
          buf = `${heading}\n`;
        }
        buf += `${para}\n`;
      }
      if (buf.trim().length > 20) out.push({ heading, content: buf.trim() });
    }
    return out;
  }
}
