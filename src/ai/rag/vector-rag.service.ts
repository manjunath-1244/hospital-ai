import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EmbeddingProvider } from './embedding.provider';
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
    const pieces = this.chunk(rec.text, rec.heading);
    const rows = pieces.map((p, i) => ({
      id: `${rec.source}#${i}`,
      heading: p.heading,
      content: p.content,
      contentHash: createHash('sha256')
        .update(`${this.embedder.modelId}\n${p.content}`)
        .digest('hex'),
    }));

    const existing = await this.store.getHashes(rec.source);
    const changed = rows.filter((r) => existing.get(r.id) !== r.contentHash);
    if (changed.length) {
      const vectors = await this.embedder.embed(changed.map((c) => c.content));
      const chunks: StoredChunk[] = changed.map((c, i) => ({
        id: c.id,
        source: rec.source,
        kind: rec.kind,
        patientId: rec.patientId ? rec.patientId.toUpperCase() : null,
        heading: c.heading,
        content: c.content,
        contentHash: c.contentHash,
        embedding: vectors[i],
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

  async searchPolicies(query: string, topK = 4): Promise<SearchHit[]> {
    const vec = await this.embedQueryCached(query);
    return this.store.search(vec, { topK, kind: 'policy' });
  }

  async searchPatientRecords(
    query: string,
    patientId: string | undefined,
    topK = 4,
  ): Promise<SearchHit[]> {
    const vec = await this.embedQueryCached(query);
    return this.store.search(vec, { topK, kind: 'patient_record', patientId });
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
