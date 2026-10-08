import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingProvider } from './embedding.provider';

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
  score: number;
  metadata?: Record<string, any>;
  citationSpan?: string;
  quote?: string;
}

/** Storage port for vectors. RagService depends on this abstraction, so another backend can replace pgvector. */
export abstract class VectorStore {
  abstract getHashes(source: string): Promise<Map<string, string>>;
  abstract upsert(chunks: StoredChunk[]): Promise<void>;
  abstract deleteExcept(source: string, keepIds: string[]): Promise<void>;
  abstract search(
    embedding: number[],
    opts: { topK: number; kind: DocKind; patientId?: string },
  ): Promise<SearchHit[]>;
  abstract searchHybrid(
    queryText: string,
    embedding: number[],
    opts: {
      topK: number;
      kind: DocKind;
      patientId?: string;
      metadata?: Record<string, any>;
    },
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
        `CREATE INDEX IF NOT EXISTS document_embeddings_tsv ON document_embeddings USING gin(to_tsvector('english', heading || ' ' || content))`,
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

  async search(
    embedding: number[],
    opts: { topK: number; kind: DocKind; patientId?: string },
  ): Promise<SearchHit[]> {
    const params: unknown[] = [
      `[${embedding.join(',')}]`,
      this.embedder.modelId,
      opts.kind,
      opts.topK,
    ];
    let patientFilter = '';
    if (opts.patientId) {
      params.push(opts.patientId.toUpperCase());
      patientFilter = `AND patient_id = $5`;
    }
    const rows = await this.dataSource.query(
      `SELECT source, heading, content, patient_id, metadata, 1 - (embedding <=> $1::vector) AS score
       FROM document_embeddings
       WHERE embedding_model = $2 AND kind = $3 ${patientFilter}
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      params,
    );
    return rows.map((r: any) => ({
      source: r.source,
      heading: r.heading,
      content: r.content,
      patientId: r.patient_id,
      metadata: r.metadata ?? {},
      score: Number(Number(r.score).toFixed(4)),
      citationSpan: `[${r.source} # ${r.heading}]`,
      quote: r.content.slice(0, 150) + (r.content.length > 150 ? '...' : ''),
    }));
  }

  /** Hybrid search combining Vector Cosine Similarity and PostgreSQL tsvector Full-Text Search via Reciprocal Rank Fusion (RRF). */
  async searchHybrid(
    queryText: string,
    embedding: number[],
    opts: {
      topK: number;
      kind: DocKind;
      patientId?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<SearchHit[]> {
    const vectorHits = await this.search(embedding, opts);

    let ftsHits: SearchHit[] = [];
    try {
      const cleanQuery = queryText.replace(/[^\w\s]/g, ' ').trim();
      if (cleanQuery) {
        const params: unknown[] = [
          cleanQuery,
          this.embedder.modelId,
          opts.kind,
          opts.topK * 2,
        ];
        let patientFilter = '';
        if (opts.patientId) {
          params.push(opts.patientId.toUpperCase());
          patientFilter = `AND patient_id = $5`;
        }
        const rows = await this.dataSource.query(
          `SELECT source, heading, content, patient_id, metadata,
                  ts_rank_cd(to_tsvector('english', heading || ' ' || content), plainto_tsquery('english', $1)) AS fts_score
           FROM document_embeddings
           WHERE embedding_model = $2 AND kind = $3 ${patientFilter}
             AND to_tsvector('english', heading || ' ' || content) @@ plainto_tsquery('english', $1)
           ORDER BY fts_score DESC
           LIMIT $4`,
          params,
        );
        ftsHits = rows.map((r: any) => ({
          source: r.source,
          heading: r.heading,
          content: r.content,
          patientId: r.patient_id,
          metadata: r.metadata ?? {},
          score: Number(Number(r.fts_score).toFixed(4)),
          citationSpan: `[${r.source} # ${r.heading}]`,
          quote:
            r.content.slice(0, 150) + (r.content.length > 150 ? '...' : ''),
        }));
      }
    } catch (err: any) {
      this.logger.debug(`FTS query skipped: ${err.message}`);
    }

    if (!ftsHits.length) return vectorHits;

    const k = 60;
    const scores = new Map<string, { hit: SearchHit; rrfScore: number }>();

    vectorHits.forEach((hit, rank) => {
      const key = `${hit.source}#${hit.heading}`;
      const rrf = 1 / (k + rank + 1);
      scores.set(key, { hit, rrfScore: rrf });
    });

    ftsHits.forEach((hit, rank) => {
      const key = `${hit.source}#${hit.heading}`;
      const rrf = 1 / (k + rank + 1);
      const existing = scores.get(key);
      if (existing) {
        existing.rrfScore += rrf;
      } else {
        scores.set(key, { hit, rrfScore: rrf });
      }
    });

    return [...scores.values()]
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, opts.topK)
      .map(({ hit, rrfScore }) => ({
        ...hit,
        score: Number(rrfScore.toFixed(4)),
        citationSpan: `[${hit.source} # ${hit.heading}]`,
        quote:
          hit.content.slice(0, 150) + (hit.content.length > 150 ? '...' : ''),
      }));
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
