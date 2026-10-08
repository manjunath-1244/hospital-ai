import { Injectable, Logger } from '@nestjs/common';
import { RagRecord, VectorRagService } from '../ai/rag/vector-rag.service';

/**
 * Best-effort work that happens AFTER the authoritative database commit (FHIR copy, search indexing).
 * A failure here must never lose or undo the record; it is logged, reported back as a flag, and repaired later by the
 * start-up backfill or the admin "Re-index everything".
 */
@Injectable()
export class PostCommitService {
  private readonly logger = new Logger(PostCommitService.name);

  constructor(private readonly rag: VectorRagService) {}

  /** Runs one side effect; returns whether it succeeded. */
  async run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err: any) {
      this.logger.warn(
        `${label} failed (record already saved): ${err.message}`,
      );
      return false;
    }
  }

  index(rec: RagRecord): Promise<boolean> {
    return this.run(`RAG index ${rec.source}`, () => this.rag.ingest(rec));
  }
}
