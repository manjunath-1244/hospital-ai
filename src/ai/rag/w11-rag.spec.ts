import { PgVectorStore, SearchHit } from './pgvector-rag.service';
import { VectorRagService } from './vector-rag.service';

describe('W11 RAG Improvements & Hybrid Search', () => {
  let ragService: VectorRagService;
  let mockStore: any;
  let mockEmbedder: any;

  beforeEach(() => {
    mockEmbedder = {
      modelId: 'test-embedding-model',
      dimensions: 1536,
      embed: jest.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
      embedQuery: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };

    mockStore = {
      getHashes: jest.fn().mockResolvedValue(new Map()),
      upsert: jest.fn().mockResolvedValue(undefined),
      deleteExcept: jest.fn().mockResolvedValue(undefined),
      search: jest.fn().mockResolvedValue([
        {
          source: 'cardiology-referral-guidelines.md',
          heading: 'Section 1: Chest Pain Protocol',
          content:
            'Chest pain protocol requires elevated Troponin T (>0.04 ng/mL) or NEWS2 score >= 5.',
          patientId: null,
          score: 0.88,
          citationSpan:
            '[cardiology-referral-guidelines.md # Section 1: Chest Pain Protocol]',
          quote: 'Chest pain protocol requires elevated Troponin T...',
        },
      ]),
      searchHybrid: jest.fn().mockResolvedValue([
        {
          source: 'cardiology-referral-guidelines.md',
          heading: 'Section 1: Chest Pain Protocol',
          content:
            'Chest pain protocol requires elevated Troponin T (>0.04 ng/mL) or NEWS2 score >= 5.',
          patientId: null,
          score: 0.95,
          citationSpan:
            '[cardiology-referral-guidelines.md # Section 1: Chest Pain Protocol]',
          quote: 'Chest pain protocol requires elevated Troponin T...',
        },
      ]),
      count: jest.fn().mockResolvedValue(10),
    };

    ragService = new VectorRagService(mockStore, mockEmbedder);
  });

  describe('Query Rewriting', () => {
    it('expands follow-up query containing pronouns using conversation summary', () => {
      const original = 'what is his current dosage?';
      const summary = 'Patient P1001 Eleanor Vance taking Aspirin 81mg';

      const rewritten = ragService.rewriteQuery(original, summary);

      expect(rewritten).toContain(
        'Patient P1001 Eleanor Vance taking Aspirin 81mg',
      );
      expect(rewritten).toContain('what is his current dosage?');
    });

    it('returns original query unchanged if no pronouns are present', () => {
      const original = 'What are the cardiology referral criteria?';
      const summary = 'Patient P1001 Eleanor Vance';

      const rewritten = ragService.rewriteQuery(original, summary);

      expect(rewritten).toBe('What are the cardiology referral criteria?');
    });
  });

  describe('Reranking', () => {
    it('boosts hits containing exact keyword matches', () => {
      const hits: SearchHit[] = [
        {
          source: 'doc1.md',
          heading: 'General Protocol',
          content: 'General guidelines for hospital admission.',
          patientId: null,
          score: 0.9,
        },
        {
          source: 'doc2.md',
          heading: 'Troponin and NEWS2 Criteria',
          content:
            'Troponin T levels above 0.04 ng/mL indicate myocardial infarction.',
          patientId: null,
          score: 0.85,
        },
      ];

      const reranked = ragService.rerank('troponin', hits);

      expect(reranked[0].source).toBe('doc2.md'); // doc2 boosted because of exact 'troponin' match
    });
  });

  describe('Context Compression', () => {
    it('compresses context to stay within specified character cap', () => {
      const hits: SearchHit[] = [
        {
          source: 'doc1.md',
          heading: 'H1',
          content: 'A'.repeat(100),
          patientId: null,
          score: 0.9,
        },
        {
          source: 'doc2.md',
          heading: 'H2',
          content: 'B'.repeat(100),
          patientId: null,
          score: 0.8,
        },
      ];

      const compressed = ragService.compressContext(hits, 150);

      expect(compressed.length).toBe(2);
      expect(compressed[0].content.length).toBe(100);
      expect(compressed[1].content).toContain('...');
    });
  });

  describe('Hybrid Search with Citations', () => {
    it('executes hybrid search and returns structured citation spans', async () => {
      const hits = await ragService.searchPolicies('cardiology chest pain', 4);

      expect(hits.length).toBe(1);
      expect(hits[0].score).toBe(0.95);
      expect(hits[0].citationSpan).toBe(
        '[cardiology-referral-guidelines.md # Section 1: Chest Pain Protocol]',
      );
      expect(hits[0].quote).toBeDefined();
    });
  });
});

import { fuseRanks } from './pgvector-rag.service';

const hit = (
  source: string,
  heading: string,
  docType: string,
  similarity = 0.6,
) =>
  ({
    source,
    heading,
    content: 'x',
    patientId: null,
    score: similarity,
    similarity,
    metadata: { docType },
  }) as SearchHit;

describe('rank fusion (the production search path)', () => {
  it('a chunk found by BOTH the vector and the keyword search outranks one found by only one', () => {
    const a = hit('a.md', 'A', 'policy');
    const b = hit('b.md', 'B', 'policy');
    const c = hit('c.md', 'C', 'policy');
    const fused = fuseRanks([b, a, c], [a], { topK: 3 });
    expect(fused[0].source).toBe('a.md');
  });
  it('a preferred document type gets a bonus but cannot hide a far better match', () => {
    const guideline = hit('g.md', 'G', 'guideline');
    const policy = hit('p.md', 'P', 'policy');
    // neutral: the guideline is first in both rankings
    expect(
      fuseRanks([guideline, policy], [guideline, policy], { topK: 2 })[0]
        .source,
    ).toBe('g.md');
    // preferring policies lifts the policy when the rankings are close...
    expect(
      fuseRanks([guideline, policy], [policy, guideline], {
        topK: 2,
        preferDocTypes: ['policy'],
      })[0].source,
    ).toBe('p.md');
    // ...but not when the guideline is clearly better in both
    const many = Array.from({ length: 60 }, (_, i) =>
      hit(`x${i}.md`, 'X', 'guideline'),
    );
    const out = fuseRanks([...many, policy], [...many, policy], {
      topK: 3,
      preferDocTypes: ['policy'],
    });
    expect(out.some((h) => h.source === 'p.md')).toBe(false);
  });
  it('keeps the best cosine similarity on fused hits', () => {
    const v = hit('a.md', 'A', 'policy', 0.7);
    const k = hit('a.md', 'A', 'policy', 0.5);
    expect(fuseRanks([v], [k], { topK: 1 })[0].similarity).toBe(0.7);
  });
  it('works with the keyword leg empty (vector only)', () => {
    expect(
      fuseRanks([hit('a.md', 'A', 'policy')], [], { topK: 5 }),
    ).toHaveLength(1);
  });
});
