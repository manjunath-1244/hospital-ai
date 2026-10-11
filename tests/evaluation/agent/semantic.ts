/**
 * ============================================================================
 * 🌊 CONCEPT: Drift (Semantic & Behavioral Drift Detection)
 * ============================================================================
 * WHAT IT IS:
 * The gradual deviation of model output or system behavior over time due to
 * underlying LLM weight updates, prompt modifications, or changes in distribution
 * of clinical queries.
 *
 * HOW IMPLEMENTED:
 * - Semantic Cosine Distance Scoring (`SemanticScorer`):
 *   - Uses local embedding model (`EmbeddingProvider`) to embed the generated answer
 *     and a verified, golden ground-truth reference passage.
 *   - Computes cosine similarity between generated text and clinical reference.
 *   - If similarity drops below threshold (`SEMANTIC_DEFAULT_MIN = 0.60`),
 *     flags immediate semantic drift for human clinical review.
 * - Production Metric Drift (`detectDrift` in `src/ai/observability/metrics.ts`):
 *   - Compares sliding production windows against baselines for shifts in error rate,
 *     tool failure frequency, p95 latency spikes, and average tool calls per run.
 *
 * USE CASE:
 * Prevents "silent model degradation" where answers superficially pass string matches
 * but subtly wander away from evidence-based clinical guidance.
 * ============================================================================
 * Semantic layer of the agent evaluation. It runs AFTER the deterministic checks and answers a different question:
 * "does the final answer MEAN what a correct answer means?" It embeds the answer and a short plain-words reference
 * with the same local embedding model the RAG uses and compares them (cosine similarity). It cannot judge clinical
 * truth; it catches answers that are about something else, or evasive, when every string check happened to pass.
 * Low similarity is a FLAG for a human to read, not an automatic failure.
 */
import type { EmbeddingProvider } from '../../../src/ai/rag/embedding.provider';

export const SEMANTIC_DEFAULT_MIN = 0.6;

export class SemanticScorer {
  private cache = new Map<string, number[]>();
  constructor(private readonly embedder: EmbeddingProvider) {}

  private async vector(text: string): Promise<number[]> {
    const key = text.slice(0, 2000);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const [v] = await this.embedder.embed([key]);
    this.cache.set(key, v);
    return v;
  }

  async similarity(answer: string, reference: string): Promise<number> {
    const [a, b] = await Promise.all([this.vector(answer), this.vector(reference)]);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  }
}
