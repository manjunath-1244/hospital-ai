import { Injectable, Logger } from '@nestjs/common';
import { RagRecord, VectorRagService } from '../ai/rag/vector-rag.service';

/**
 * ============================================================================
 * 📬 CONCEPT: Decoupled Post-Commit Hooks & Resilience Pattern
 * ============================================================================
 * WHAT IT IS:
 * Distributed systems pattern that executes secondary side effects (external FHIR sync,
 * vector indexing, audit broadcasting) strictly AFTER authoritative database transactions commit.
 *
 * HOW IMPLEMENTED:
 * - Isolation from Authoritative Commits:
 *   Ensures primary patient database writes succeed regardless of downstream failures in
 *   external systems (HAPI FHIR, pgvector embeddings).
 * - Safe Error Containment:
 *   Catches external network failures, logs warnings, and flags records as unsynced
 *   (`fhirSynced: false`) without rolling back the primary medical chart.
 * - Eventual Consistency & Self-Healing:
 *   Unsynced items are safely repaired during system startup backfills or admin reindexing.
 *
 * USE CASE:
 * Guarantees that local electronic health records are never blocked, delayed, or lost
 * due to external EHR network latency or vector database indexing glitches.
 * ============================================================================
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
