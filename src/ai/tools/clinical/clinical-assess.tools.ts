import { z } from 'zod';
import { VectorRagService } from '../../rag/vector-rag.service';
import { HospitalLifecycleService } from '../../../hospital/hospital-lifecycle.service';
import { News2Service } from '../../../hospital/news2.service';
import { looseBool, looseEnum, looseInt, looseNumber, looseStringList } from '../loose-schema';
import { ClinicalTool } from '../tool-registry';

export function buildClinicalAssessTools(d: {
  rag: VectorRagService;
  lifecycle: HospitalLifecycleService;
  news2: News2Service;
}): ClinicalTool[] {
  return [
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
        const matches = await d.rag.searchPatientRecords(query, patientId, topK);
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
    {
      name: 'verifyMedicationSafety',
      description:
        'Screen medications for a patient against allergies, current meds, interactions and renal function (eGFR). Use before suggesting or approving any prescription.',
      inputSchema: z.object({
        patientId: z.string(),
        medications: looseStringList().refine(
          (l) => l.length > 0,
          'at least one medication',
        ),
      }),
      roles: ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN'],
      async run({ patientId, medications }) {
        return {
          success: true,
          ...(await d.lifecycle.pharmacyAudit(patientId, medications)),
        };
      },
    },
    {
      name: 'assessTriage',
      description:
        'Compute NEWS2, SIRS screen and a suggested ESI level from vitals. Calculation only: does not save anything.',
      inputSchema: z.object({
        heartRate: looseNumber(),
        bpSystolic: looseNumber(),
        spO2: looseNumber(),
        tempCelsius: looseNumber(),
        respiratoryRate: looseNumber(),
        consciousness: looseEnum(
          ['ALERT', 'CONFUSION', 'VOICE', 'PAIN', 'UNRESPONSIVE'] as const,
          {
            confused: 'CONFUSION',
            confusion: 'CONFUSION',
            disoriented: 'CONFUSION',
            'new confusion': 'CONFUSION',
            responds_to_voice: 'VOICE',
            'responds to voice': 'VOICE',
            'responds to pain': 'PAIN',
            unconscious: 'UNRESPONSIVE',
            normal: 'ALERT',
            awake: 'ALERT',
          },
        ).default('ALERT'),
        onSupplementalO2: looseBool().default(false),
      }),
      roles: ['DOCTOR', 'NURSE', 'ADMIN'],
      async run(i) {
        return { success: true, ...d.news2.assess(i) };
      },
    },
  ];
}
