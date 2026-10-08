import { z } from 'zod';
import { HospitalService } from '../../hospital/hospital.service';
import { PatientDirectoryService } from '../../hospital/patient-directory.service';
import { SpecialistService } from '../../hospital/specialists/specialist.service';
import { OverviewService } from '../../hospital/overview.service';
import { HospitalLifecycleService } from '../../hospital/hospital-lifecycle.service';
import { PatientSummaryService } from '../../hospital/patient-summary.service';
import { looseInt } from './loose-schema';
import { ALL_STAFF, ClinicalTool } from './tool-registry';

const patientId = z.string().describe('Patient ID, e.g. P1001');

/**
 * Patient/record access tools. Few, broad tools beat many narrow ones: fewer round trips, smaller prompts,
 * and the model cannot "forget" to fetch a section (a summary always contains everything the role may see).
 */
export function buildHospitalTools(d: {
  hospital: HospitalService;
  summaries: PatientSummaryService;
  directory: PatientDirectoryService;
  overview: OverviewService;
  lifecycle: HospitalLifecycleService;
  specialists: SpecialistService;
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
      roles: ALL_STAFF,
      async run({ patientId }, { user }) {
        return {
          success: true,
          ...(await d.summaries.summary(patientId, user.role)),
        };
      },
    },
    {
      name: 'getHospitalOverview',
      description:
        'Headline numbers: total patients, visits by status, waiting for triage, waiting for a doctor, with a doctor, completed today, longest wait, critical labs in the last 24h, pending tasks, scheduled appointments.',
      inputSchema: z.object({}),
      roles: ['DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR'],
      async run() {
        return { success: true, ...(await d.overview.get()) };
      },
    },
    {
      name: 'findSpecialists',
      description:
        'List specialists (id, name, specialty, whether they are available). Optionally only one specialty, e.g. Cardiology or Neurology. Use it before booking or referring so you use a real doctor id.',
      inputSchema: z.object({ specialty: z.string().optional() }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      async run({ specialty }) {
        return {
          success: true,
          specialties: await d.specialists.specialties(),
          specialists: await d.specialists.find({ specialty }),
        };
      },
    },
    {
      name: 'getSpecialistAvailability',
      description:
        'Free appointment slots (ISO date-times, earliest first) for one specialist by doctor id, plus the next free slot. Never invent a time: book only one of these.',
      inputSchema: z.object({
        doctorId: z.string(),
        limit: looseInt({ min: 1, max: 50 }).default(10),
      }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      async run({ doctorId, limit }) {
        const { doctor, slots } = await d.specialists.getAvailability(
          doctorId,
          {
            limit,
          },
        );
        return { success: true, doctor, nextFreeSlot: slots[0] ?? null, slots };
      },
    },
    {
      name: 'getAppointmentsAndTasks',
      description:
        'List scheduled appointments and staff tasks, optionally for one patient.',
      inputSchema: z.object({ patientId: patientId.optional() }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      async run({ patientId }) {
        const appointments = patientId
          ? await d.hospital.getAppointmentsForPatient(patientId)
          : await d.hospital.getAppointments();
        const tasks = patientId
          ? await d.hospital.getTasksForPatient(patientId)
          : await d.hospital.getTasks();
        return {
          success: true,
          appointments: appointments.slice(0, 50),
          tasks: tasks.slice(0, 50),
        };
      },
    },
    {
      name: 'bookAppointment',
      description:
        'Book an appointment. Only call after the user has explicitly confirmed patient, doctor, department and time.',
      inputSchema: z.object({
        patientId,
        doctorId: z
          .string()
          .optional()
          .describe('Doctor account id from findSpecialists (preferred)'),
        doctorName: z.string().optional(),
        department: z.string().optional(),
        dateTime: z.string().describe('ISO 8601 date-time'),
        reason: z.string(),
      }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'],
      async run(i) {
        return {
          success: true,
          appointment: await d.lifecycle.bookAppointment(i),
        };
      },
    },
    {
      name: 'createStaffTask',
      description:
        'Create a task for staff. Only call after the user has explicitly confirmed the details.',
      inputSchema: z.object({
        title: z.string(),
        assignedTo: z.string(),
        patientId: patientId.optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
      }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      async run(i) {
        return {
          success: true,
          task: await d.lifecycle.createTask(i),
        };
      },
    },
  ];
}
