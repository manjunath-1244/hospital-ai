import { Entity, PrimaryColumn } from 'typeorm';

/**
 * Declares the vector-index table to TypeORM ONLY so schema tooling knows it exists and never proposes to drop it.
 * The table itself (pgvector column, HNSW index) is created and rebuilt by `PgVectorStore.init()`, because its vector
 * dimension depends on the configured embedding model. It is derived data and is never part of a migration.
 */
@Entity('document_embeddings', { synchronize: false })
export class DocumentEmbeddingEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;
}
