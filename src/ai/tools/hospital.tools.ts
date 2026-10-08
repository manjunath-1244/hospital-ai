import { z } from 'zod';
import { HospitalService } from '../../hospital/hospital.service';
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
}): ClinicalTool[] {
  return [
    {
      name: 'searchPatients',
      description:
        'List or find patients. Use it for "all patients", "who is waiting", "find Eleanor", or to resolve a name to an id. query matches name or id; status is WAITING, SEEN, CLOSED or ALL.',
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe('Name or id fragment; omit to list everyone'),
        status: z.enum(['WAITING', 'SEEN', 'CLOSED', 'ALL']).default('ALL'),
        limit: looseInt({ min: 1, max: 100 }).default(50),
      }),
      roles: ALL_STAFF,
      async run({ query, status, limit }) {
        const { items, total } = await d.hospital.listPatients({
          q: query,
          limit,
          status: status === 'ALL' ? undefined : status,
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
            chiefComplaint: p.chiefComplaint,
            status: p.consultationStatus,
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
        'Headline numbers: total patients, waiting, seen, closed, longest wait, critical labs in the last 24h, pending tasks, scheduled appointments.',
      inputSchema: z.object({}),
      roles: ['DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR'],
      async run() {
        return { success: true, ...(await d.hospital.overview()) };
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
        doctorName: z.string(),
        department: z.string(),
        dateTime: z.string().describe('ISO 8601 date-time'),
        reason: z.string(),
      }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'],
      async run(i) {
        return {
          success: true,
          appointment: await d.hospital.bookAppointment(
            i.patientId,
            i.doctorName,
            i.department,
            i.dateTime,
            i.reason,
          ),
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
          task: await d.hospital.createTask(
            i.title,
            i.assignedTo,
            i.patientId,
            i.priority,
          ),
        };
      },
    },
  ];
}
