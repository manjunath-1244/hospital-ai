import { z } from 'zod';
import { FhirHapiClient } from '../../fhir/fhir-hapi.client';
import { OrthancClient } from '../../dicom/orthanc.client';
import { VectorRagService } from '../../rag/vector-rag.service';
import { looseInt, looseNumber } from '../loose-schema';
import { ALL_STAFF, ClinicalTool } from '../tool-registry';

export function buildInteropTools(
  fhir: FhirHapiClient,
  orthanc: OrthancClient,
  rag?: VectorRagService,
): ClinicalTool[] {
  const tools: ClinicalTool[] = [
    {
      name: 'queryLiveHapiFhirPatients',
      description:
        'Query the live HAPI FHIR server for Patient resources. Returns an error if the server is unreachable.',
      inputSchema: z.object({
        count: looseInt({ min: 1, max: 50 }).default(10),
      }),
      roles: ['ADMIN'],
      async run({ count }) {
        const bundle = await fhir.searchPatients(count);
        return {
          success: true,
          total: bundle.total,
          entries: (bundle.entry ?? []).map((e: any) => ({
            id: e.resource?.id,
            gender: e.resource?.gender,
          })),
        };
      },
    },
    {
      name: 'queryLiveOrthancStudies',
      description:
        'Query the Orthanc PACS (QIDO-RS) for imaging studies. Returns an error if PACS is unreachable.',
      inputSchema: z.object({}),
      roles: ['RADIOLOGIST', 'ADMIN'],
      async run() {
        const studies = await orthanc.listStudies();
        return { success: true, count: studies.length };
      },
    },
  ];

  if (rag) {
    tools.push({
      name: 'searchHospitalPolicies',
      description:
        'Semantic search over official hospital policies and SOPs (discharge, triage, escalation, medication administration, appointments). Always cite results.',
      inputSchema: z.object({
        query: z.string().min(2),
        topK: looseInt({ min: 1, max: 8 }).default(4),
        minScore: looseNumber({ min: 0, max: 1 })
          .optional()
          .describe('Optional relevance cutoff 0-1'),
        docType: z
          .enum(['policy', 'sop', 'guideline'])
          .optional()
          .describe(
            'Only this kind of document (policy/sop: who does what; guideline: clinical criteria). Usually omit.',
          ),
      }),
      roles: [...ALL_STAFF, 'SPECIALIST'],
      async run({ query, topK, minScore, docType }) {
        // minScore is a relevance cut-off on cosine similarity (not on the fused rank score)
        const matches = await rag.searchPolicies(query, topK, {
          minSimilarity: minScore,
          docTypes: docType ? [docType] : undefined,
        });
        return {
          success: true,
          count: matches.length,
          matches: matches.map((m) => ({
            file: m.source,
            heading: m.heading,
            text: m.content,
            score: m.score,
            similarity: m.similarity,
          })),
        };
      },
      citations: (out) =>
        (out?.matches ?? []).map((m: any) => ({
          file: m.file,
          heading: m.heading,
        })),
    });
  }

  return tools;
}
