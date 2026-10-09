import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingProvider } from './embedding.provider';
import { toOrTsQuery } from './query-terms';

export type DocKind = 'policy' | 'patient_record';

export interface StoredChunk {
  id: string;
  source: string;
  kind: DocKind;
  patientId: string | null;
  heading: string;
  content: string;
  contentHash: string;
  embedding: number[];
  metadata?: Record<string, any>;
}

export interface SearchHit {
  source: string;
  heading: string;
  content: string;
  patientId: string | null;
  /** Ranking score (cosine for dense search, fused rank score for hybrid). */
  score: number;
  /** Cosine similarity to the query (0-1), present on every hit: the measure of 'is this actually about my question'. */
  similarity?: number;
  metadata?: Record<string, any>;
  citationSpan?: string;
  quote?: string;
}

export interface SearchOptions {
  topK: number;
  kind: DocKind;
  patientId?: string;
  /** Only chunks of these document types (policy | sop | guideline). */
  docTypes?: string[];
  /** Chunks of these types get a rank bonus (a preference, not a filter). */
  preferDocTypes?: string[];
}

/** Storage port for vectors. RagService depends on this abstraction, so another backend can replace pgvector. */
export abstract class VectorStore {
  abstract getHashes(source: string): Promise<Map<string, string>>;
  abstract upsert(chunks: StoredChunk[]): Promise<void>;
  abstract deleteExcept(source: string, keepIds: string[]): Promise<void>;
  abstract search(
    embedding: number[],
    opts: SearchOptions,
  ): Promise<SearchHit[]>;
  /** Vector similarity + keyword (any meaningful word) search fused by rank (RRF). The production search path. */
  abstract searchHybrid(
    queryText: string,
    embedding: number[],
    opts: SearchOptions,
  ): Promise<SearchHit[]>;
  abstract count(): Promise<number>;
  abstract deleteByPatient(patientId: string): Promise<number>;
  abstract deleteBySource(source: string): Promise<number>;
  abstract countBySource(source: string): Promise<number>;
}

/** PostgreSQL + pgvector implementation: `vector(N)` column, HNSW index, cosine distance in SQL. */
export class PgVectorStore extends VectorStore {
  private readonly logger = new Logger(PgVectorStore.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly embedder: EmbeddingProvider,
  ) {
    super();
  }

  /** Creates the schema. Called once by the module factory, before anything queries the store. */
  async init() {
    const dims = this.embedder.dimensions;
    await this.dataSource.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // The table is derived data (rebuilt from policies + patient records), so a dimension change just rebuilds it.
    const col = await this.dataSource.query(
      `SELECT atttypmod AS dims FROM pg_attribute
       WHERE attrelid = to_regclass('document_embeddings') AND attname = 'embedding'`,
    );
    if (col.length && col[0].dims !== dims) {
      this.logger.warn(
        `Embedding dimension changed (${col[0].dims} -> ${dims}); rebuilding document_embeddings.`,
      );
      await this.dataSource.query(`DROP TABLE document_embeddings`);
    }

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS document_embeddings (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        patient_id TEXT,
        heading TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        embedding vector(${dims}) NOT NULL,
        metadata JSONB DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS document_embeddings_hnsw ON document_embeddings USING hnsw (embedding vector_cosine_ops)`,
    );
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS document_embeddings_source ON document_embeddings (source)`,
    );
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS document_embeddings_patient ON document_embeddings (patient_id)`,
    );
    try {
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS document_embeddings_tsv2 ON document_embeddings USING gin(to_tsvector('english', heading || ' ' || coalesce(metadata->>'title','') || ' ' || content))`,
      );
    } catch {
      // safe fallback if tsvector index exists or unhandled
    }
    this.logger.log(
      `pgvector ready: vector(${dims}), HNSW cosine index, model ${this.embedder.modelId}.`,
    );
  }

  async getHashes(source: string): Promise<Map<string, string>> {
    const rows = await this.dataSource.query(
      `SELECT id, content_hash FROM document_embeddings WHERE source = $1 AND embedding_model = $2`,
      [source, this.embedder.modelId],
    );
    return new Map(rows.map((r: any) => [r.id, r.content_hash]));
  }

  async upsert(chunks: StoredChunk[]): Promise<void> {
    for (const c of chunks) {
      await this.dataSource.query(
        `INSERT INTO document_embeddings (id, source, kind, patient_id, heading, content, content_hash, embedding_model, embedding, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           source=EXCLUDED.source, kind=EXCLUDED.kind, patient_id=EXCLUDED.patient_id, heading=EXCLUDED.heading,
           content=EXCLUDED.content, content_hash=EXCLUDED.content_hash, embedding_model=EXCLUDED.embedding_model,
           embedding=EXCLUDED.embedding, metadata=EXCLUDED.metadata, updated_at=now()`,
        [
          c.id,
          c.source,
          c.kind,
          c.patientId,
          c.heading,
          c.content,
          c.contentHash,
          this.embedder.modelId,
          `[${c.embedding.join(',')}]`,
          JSON.stringify(c.metadata ?? {}),
        ],
      );
    }
  }

  async deleteExcept(source: string, keepIds: string[]): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM document_embeddings WHERE source = $1 AND NOT (id = ANY($2::text[]))`,
      [source, keepIds],
    );
  }

  async search(embedding: number[], opts: SearchOptions): Promise<SearchHit[]> {
    const params: unknown[] = [
      `[${embedding.join(',')}]`,
      this.embedder.modelId,
      opts.kind,
      opts.topK,
    ];
    let filters = '';
    if (opts.patientId) {
      params.push(opts.patientId.toUpperCase());
      filters += ` AND patient_id = $${params.length}`;
    }
    if (opts.docTypes?.length) {
      params.push(opts.docTypes);
      filters += ` AND metadata->>'docType' = ANY($${params.length}::text[])`;
    }
    const rows = await this.dataSource.query(
      `SELECT source, heading, content, patient_id, metadata, 1 - (embedding <=> $1::vector) AS score
       FROM document_embeddings
       WHERE embedding_model = $2 AND kind = $3 ${filters}
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      params,
    );
    return rows.map((r: any) =>
      this.toHit(r, Number(r.score), Number(r.score)),
    );
  }

  private toHit(r: any, score: number, similarity: number): SearchHit {
    return {
      source: r.source,
      heading: r.heading,
      content: r.content,
      patientId: r.patient_id,
      metadata: r.metadata ?? {},
      score: Number(score.toFixed(4)),
      similarity: Number(similarity.toFixed(4)),
      citationSpan: `[${r.source} # ${r.heading}]`,
      quote: r.content.slice(0, 150) + (r.content.length > 150 ? '...' : ''),
    };
  }

  /**
   * Hybrid search: vector similarity and keyword match (PostgreSQL full text, ANY meaningful word) are ranked
   * separately and fused with Reciprocal Rank Fusion. Chunks of a preferred document type get a rank bonus.
   * Every hit carries its cosine similarity, so callers can still apply a relevance cut-off.
   */
  async searchHybrid(
    queryText: string,
    embedding: number[],
    opts: SearchOptions,
  ): Promise<SearchHit[]> {
    const pool = Math.max(opts.topK * 3, 12);
    const vectorHits = await this.search(embedding, { ...opts, topK: pool });

    let ftsHits: SearchHit[] = [];
    const tsQuery = toOrTsQuery(queryText);
    if (tsQuery) {
      try {
        const params: unknown[] = [
          tsQuery,
          this.embedder.modelId,
          opts.kind,
          pool,
          `[${embedding.join(',')}]`,
        ];
        let filters = '';
        if (opts.patientId) {
          params.push(opts.patientId.toUpperCase());
          filters += ` AND patient_id = $${params.length}`;
        }
        if (opts.docTypes?.length) {
          params.push(opts.docTypes);
          filters += ` AND metadata->>'docType' = ANY($${params.length}::text[])`;
        }
        const doc = `to_tsvector('english', heading || ' ' || coalesce(metadata->>'title','') || ' ' || content)`;
        const rows = await this.dataSource.query(
          `SELECT source, heading, content, patient_id, metadata,
                  ts_rank_cd(${doc}, to_tsquery('english', $1), 1) AS fts_score, -- 1 = divide by chunk length: a short chunk about the words beats a long one that merely mentions them
                  1 - (embedding <=> $5::vector) AS similarity
             FROM document_embeddings
            WHERE embedding_model = $2 AND kind = $3 ${filters}
              AND ${doc} @@ to_tsquery('english', $1)
            ORDER BY fts_score DESC
            LIMIT $4`,
          params,
        );
        ftsHits = rows.map((r: any) =>
          this.toHit(r, Number(r.fts_score), Number(r.similarity)),
        );
      } catch (err: any) {
        // A broken keyword leg must never break search: fall back to vector hits and say so.
        this.logger.warn(
          `Keyword search failed, using vector search only: ${err.message}`,
        );
      }
    }
    return fuseRanks(vectorHits, ftsHits, opts);
  }

  async count(): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM document_embeddings`,
    );
    return rows[0].n;
  }

  async deleteByPatient(patientId: string): Promise<number> {
    const r = await this.dataSource.query(
      `DELETE FROM document_embeddings WHERE patient_id = $1`,
      [patientId.toUpperCase()],
    );
    return Array.isArray(r) ? (r[1] ?? 0) : 0;
  }

  async deleteBySource(source: string): Promise<number> {
    const r = await this.dataSource.query(
      `DELETE FROM document_embeddings WHERE source = $1`,
      [source],
    );
    return Array.isArray(r) ? (r[1] ?? 0) : 0;
  }

  async countBySource(source: string): Promise<number> {
    const r = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM document_embeddings WHERE source = $1`,
      [source],
    );
    return r[0].n;
  }
}

/** Reciprocal Rank Fusion of the vector and keyword rankings, plus a bonus for preferred document types. */
export function fuseRanks(
  vectorHits: SearchHit[],
  ftsHits: SearchHit[],
  opts: { topK: number; preferDocTypes?: string[] },
): SearchHit[] {
  const K = 60;
  const key = (h: SearchHit) => `${h.source}#${h.heading}`;
  const fused = new Map<string, { hit: SearchHit; rrf: number }>();
  const add = (hits: SearchHit[]) =>
    hits.forEach((hit, rank) => {
      const cur = fused.get(key(hit));
      const part = 1 / (K + rank + 1);
      if (cur) {
        cur.rrf += part;
        cur.hit.similarity = Math.max(
          cur.hit.similarity ?? 0,
          hit.similarity ?? 0,
        );
      } else fused.set(key(hit), { hit: { ...hit }, rrf: part });
    });
  add(vectorHits);
  add(ftsHits);
  const prefer = new Set(opts.preferDocTypes ?? []);
  const bonus = 0.75 / (K + 1); // worth about "top of one ranking"
  return [...fused.values()]
    .map((f) => ({
      ...f,
      rrf: f.rrf + (prefer.has(f.hit.metadata?.docType) ? bonus : 0),
    }))
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, opts.topK)
    .map(({ hit, rrf }) => ({ ...hit, score: Number(rrf.toFixed(4)) }));
}
