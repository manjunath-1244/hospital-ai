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
      const hits = await ragService.searchPoliciesHybrid(
        'cardiology chest pain',
        4,
      );

      expect(hits.length).toBe(1);
      expect(hits[0].score).toBe(0.95);
      expect(hits[0].citationSpan).toBe(
        '[cardiology-referral-guidelines.md # Section 1: Chest Pain Protocol]',
      );
      expect(hits[0].quote).toBeDefined();
    });
  });
});
