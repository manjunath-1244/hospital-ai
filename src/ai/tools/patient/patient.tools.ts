import { z } from 'zod';
import { PatientDirectoryService } from '../../../hospital/patient-directory.service';
import { PatientSummaryService } from '../../../hospital/patient-summary.service';
import { looseInt } from '../loose-schema';
import { ALL_STAFF, ClinicalTool } from '../tool-registry';

const patientId = z.string().describe('Patient ID, e.g. P1001');

export function buildPatientTools(d: {
  directory: PatientDirectoryService;
  summaries: PatientSummaryService;
}): ClinicalTool[] {
  return [
    {
      name: 'searchPatients',
      description:
        'List or find patients. Use it for "all patients", "who is waiting", "find Eleanor", or to resolve a name to an id. query matches name or id; stage filters by where the patient is: WAITING (waiting for triage or doctor), ACTIVE (any open visit), FINISHED (last visit completed/cancelled), NO_VISIT, or ALL.',
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe('Name or id fragment; omit to list everyone'),
        stage: z
          .enum(['ALL', 'ACTIVE', 'WAITING', 'FINISHED', 'NO_VISIT'])
          .default('ALL'),
        limit: looseInt({ min: 1, max: 100 }).default(50),
      }),
      roles: ALL_STAFF,
      async run({ query, stage, limit }) {
        const { items, total } = await d.directory.list({
          q: query,
          limit,
          stage,
        });
        return {
          success: true,
          total,
          returned: items.length,
          patients: items.map((p) => ({
            id: p.id,
            name: p.name,
            age: p.age,
            gender: p.gender,
            visitId: p.visit?.id ?? null,
            chiefComplaint: p.visit?.chiefComplaint ?? null,
            status: p.visit?.status ?? 'NO_VISIT',
            statusLabel: p.visit?.statusLabel ?? 'No visit yet',
            registeredAt: p.registeredAt,
          })),
        };
      },
    },
    {
      name: 'getPatientSummary',
      description:
        'Full chart for ONE patient by id: demographics, allergies, conditions, medications, recent labs, vitals, consultations, imaging and appointments (only the parts your role may see). Use this for any question about a specific patient.',
      inputSchema: z.object({ patientId }),
      roles: [...ALL_STAFF, 'SPECIALIST'],
      async run({ patientId }, { user }) {
        return {
          success: true,
          ...(await d.summaries.summary(patientId, user.role)),
        };
      },
    },
  ];
}
