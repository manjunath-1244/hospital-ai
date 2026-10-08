/**
 * STATUS: in use but marginal. Two read-only tools for ADMIN (and RADIOLOGIST for the PACS one) that report what the
 * FHIR server / PACS currently hold. Normal chat answers never use them: they come from PostgreSQL.
 * TODO: either grow these into real reconciliation tools (compare our DB with FHIR/PACS and list differences) or remove them.
 */

import { z } from 'zod';
import { looseBool, looseInt, looseNumber } from './loose-schema';
import { FhirHapiClient } from '../fhir/fhir-hapi.client';
import { OrthancClient } from '../dicom/orthanc.client';
import { ClinicalTool } from './tool-registry';

export function buildInteropTools(
  fhir: FhirHapiClient,
  orthanc: OrthancClient,
): ClinicalTool[] {
  return [
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
}
