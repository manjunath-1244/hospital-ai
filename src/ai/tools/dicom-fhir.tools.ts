/**
 * STATUS: UNUSED (dead code). Not registered in ClinicalToolsFactory and not imported anywhere.
 * Superseded by `getPatientSummary` (src/ai/tools/hospital.tools.ts), which already returns each patient's imaging
 * studies and impressions in one call.
 *
 * TODO: delete this file (kept only because bulk deletion was not possible in the automated session).
 */

import { z } from 'zod';
import { ClinicalRecordsService } from '../../hospital/clinical-records.service';
import { ClinicalTool } from './tool-registry';

export function buildImagingTools(
  records: ClinicalRecordsService,
): ClinicalTool[] {
  return [
    {
      name: 'getPatientImagingStudies',
      description:
        "List a patient's stored imaging studies (modality, description, study date, radiologist impression).",
      inputSchema: z.object({ patientId: z.string() }),
      roles: ['DOCTOR', 'NURSE', 'RADIOLOGIST', 'ADMIN'],
      async run({ patientId }) {
        const studies = await records.listImagingStudies(patientId);
        return {
          success: true,
          studies: studies.map(({ orthancInstanceId, ...s }) => s),
        };
      },
    },
  ];
}
