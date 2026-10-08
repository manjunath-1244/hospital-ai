import { z } from 'zod';
import { looseBool, looseInt, looseNumber } from './loose-schema';
import { VectorRagService } from '../rag/vector-rag.service';
import { ClinicalTool, ALL_STAFF } from './tool-registry';

export function buildRagTools(rag: VectorRagService): ClinicalTool[] {
  return [
    {
      name: 'searchHospitalPolicies',
      description:
        'Semantic search over official hospital policies and SOPs (discharge, triage, escalation, medication administration, appointments). Always cite results.',
      inputSchema: z.object({
        query: z.string().min(2),
        topK: looseInt({ min: 1, max: 8 }).default(4),
        minScore: looseNumber({ min: 0, max: 1 })
          .optional()
          .describe('Optional relevance cutoff 0-1'),
      }),
      roles: ALL_STAFF,
      async run({ query, topK, minScore }) {
        const found = await rag.searchPolicies(query, topK);
        const matches = found.filter((m) => m.score >= (minScore ?? 0));
        return {
          success: true,
          count: matches.length,
          matches: matches.map((m) => ({
            file: m.source,
            heading: m.heading,
            text: m.content,
            score: m.score,
          })),
        };
      },
      citations: (out) =>
        (out?.matches ?? []).map((m: any) => ({
          file: m.file,
          heading: m.heading,
        })),
    },
    {
      name: 'searchClinicalRecords',
      description:
        'Semantic search over everything entered into the system: consultations, vitals, labs, imaging reports, chart summaries. Give patientId to search one patient, omit it to search across ALL patients (e.g. "who has chest pain", "patients on metformin").',
      inputSchema: z.object({
        query: z.string().min(2),
        patientId: z.string().optional(),
        topK: looseInt({ min: 1, max: 10 }).default(6),
      }),
      roles: ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN'],
      async run({ patientId, query, topK }) {
        const matches = await rag.searchPatientRecords(query, patientId, topK);
        return {
          success: true,
          count: matches.length,
          matches: matches.map((m) => ({
            patientId: m.patientId,
            source: m.source,
            heading: m.heading,
            text: m.content,
            score: m.score,
          })),
        };
      },
    },
  ];
}
