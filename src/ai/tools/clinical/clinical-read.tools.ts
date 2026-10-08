import { z } from 'zod';
import { HospitalService } from '../../../hospital/hospital.service';
import { ClinicalRecordsService } from '../../../hospital/clinical-records.service';
import { VisitsService } from '../../../hospital/visits/visits.service';
import { toVisitSummary } from '../../../hospital/visits/visit-summary';
import { MedicationSafetyService } from '../../../hospital/medication-safety.service';
import { VectorRagService } from '../../rag/vector-rag.service';
import { looseInt } from '../loose-schema';
import { ALL_STAFF, ClinicalTool } from '../tool-registry';

const patientId = z.string().describe('Patient ID, e.g. P1001');

export function buildClinicalReadTools(d: {
  hospital: HospitalService;
  records: ClinicalRecordsService;
  visits: VisitsService;
  medSafety: MedicationSafetyService;
  rag: VectorRagService;
}): ClinicalTool[] {
  return [
    {
      name: 'getCurrentVisit',
      description:
        'Get details of the current open or latest visit for a patient (visit ID, status, chief complaint, priority, arrivedAt, triagedAt, primaryDoctor, department).',
      inputSchema: z.object({ patientId }),
      roles: [...ALL_STAFF, 'SPECIALIST'],
      requires: { patientBound: true },
      async run({ patientId }) {
        const recentVisits = await d.visits.listForPatient(patientId, 1);
        const currentVisit = recentVisits.length
          ? toVisitSummary(recentVisits[0])
          : null;
        return {
          success: true,
          patientId,
          currentVisit,
        };
      },
    },
    {
      name: 'getVitalsHistory',
      description:
        'List recorded vitals history for a patient (heart rate, blood pressure, SpO2, temperature, respiratory rate, consciousness, NEWS2 score, risk level, recordedAt).',
      inputSchema: z.object({
        patientId,
        limit: looseInt({ min: 1, max: 50 }).default(10),
      }),
      roles: ['DOCTOR', 'NURSE', 'ADMIN', 'SPECIALIST'],
      requires: { patientBound: true },
      async run({ patientId, limit }) {
        const vitals = await d.records.listVitals(patientId, limit);
        return {
          success: true,
          count: vitals.length,
          vitals: vitals.map((v) => ({
            recordedAt: v.recordedAt,
            heartRate: v.heartRate,
            bpSystolic: v.bpSystolic,
            spO2: v.spO2,
            tempCelsius: v.tempCelsius,
            respiratoryRate: v.respiratoryRate,
            consciousness: v.consciousness,
            news2Score: v.news2Score,
            riskLevel: v.riskLevel,
          })),
        };
      },
    },
    {
      name: 'getLabs',
      description:
        'List lab test results for a patient (test name, value, unit, reference range, status, date).',
      inputSchema: z.object({
        patientId,
        limit: looseInt({ min: 1, max: 50 }).default(20),
      }),
      roles: [
        'DOCTOR',
        'NURSE',
        'ADMIN',
        'PHARMACIST',
        'RADIOLOGIST',
        'SPECIALIST',
      ],
      requires: { patientBound: true },
      async run({ patientId, limit }) {
        const labs = await d.hospital.getPatientLabs(patientId);
        return {
          success: true,
          count: Math.min(labs.length, limit),
          labs: labs.slice(0, limit).map((l) => ({
            testName: l.testName,
            value: l.value,
            unit: l.unit,
            referenceRange: l.referenceRange,
            status: l.status,
            date: l.date,
          })),
        };
      },
    },
    {
      name: 'getMedications',
      description:
        'Get current active medications, allergies, and medication safety alerts for a patient.',
      inputSchema: z.object({ patientId }),
      roles: [
        'DOCTOR',
        'NURSE',
        'ADMIN',
        'PHARMACIST',
        'CARE_COORDINATOR',
        'SPECIALIST',
      ],
      requires: { patientBound: true },
      async run({ patientId }) {
        const p = await d.hospital.getPatientById(patientId);
        const labs = await d.hospital.getPatientLabs(patientId);
        const cr = labs.find((l) => /creatinine/i.test(l.testName));
        const mgDl = cr
          ? d.medSafety.creatinineToMgDl(parseFloat(cr.value), cr.unit)
          : undefined;
        const report = d.medSafety.audit(
          {
            age: p.age,
            gender: p.gender,
            allergies: p.allergies,
            currentMedications: [],
          },
          p.currentMedications,
          Number.isFinite(mgDl) ? mgDl : undefined,
        );
        return {
          success: true,
          currentMedications: p.currentMedications,
          allergies: p.allergies,
          safetyAlerts: report.findings.filter((f) => f.severity !== 'INFO'),
        };
      },
    },
    {
      name: 'getAllergies',
      description:
        'Get recorded allergies and active medical conditions for a patient.',
      inputSchema: z.object({ patientId }),
      roles: [
        'DOCTOR',
        'NURSE',
        'ADMIN',
        'PHARMACIST',
        'RADIOLOGIST',
        'SPECIALIST',
      ],
      requires: { patientBound: true },
      async run({ patientId }) {
        const p = await d.hospital.getPatientById(patientId);
        return {
          success: true,
          allergies: p.allergies,
          conditions: p.conditions,
        };
      },
    },
    {
      name: 'searchClinicalGuidelines',
      description:
        'Search clinical guidelines and protocol documents (e.g. Cardiology, Neurology, Chest Pain, Stroke guidelines). Always cite sources.',
      inputSchema: z.object({
        query: z.string().min(2),
        topK: looseInt({ min: 1, max: 8 }).default(4),
      }),
      roles: [...ALL_STAFF, 'SPECIALIST'],
      async run({ query, topK }) {
        const found = await d.rag.searchPolicies(query, topK);
        return {
          success: true,
          count: found.length,
          guidelines: found.map((m) => ({
            file: m.source,
            heading: m.heading,
            text: m.content,
            score: m.score,
          })),
        };
      },
      citations: (out) =>
        (out?.guidelines ?? []).map((g: any) => ({
          file: g.file,
          heading: g.heading,
        })),
    },
  ];
}
