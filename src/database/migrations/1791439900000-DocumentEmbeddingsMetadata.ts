import { MigrationInterface, QueryRunner } from 'typeorm';

export class DocumentEmbeddingsMetadata1791439900000 implements MigrationInterface {
  name = 'DocumentEmbeddingsMetadata1791439900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "document_embeddings" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS document_embeddings_tsv ON document_embeddings USING gin(to_tsvector('english', heading || ' ' || content))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS document_embeddings_metadata ON document_embeddings USING gin(metadata)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS document_embeddings_metadata`);
    await queryRunner.query(`DROP INDEX IF EXISTS document_embeddings_tsv`);
    await queryRunner.query(`ALTER TABLE "document_embeddings" DROP COLUMN IF EXISTS "metadata"`);
  }
}
