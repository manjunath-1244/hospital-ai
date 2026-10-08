import { z } from 'zod';
import { HospitalService } from '../../../hospital/hospital.service';
import { HospitalLifecycleService } from '../../../hospital/hospital-lifecycle.service';
import { OverviewService } from '../../../hospital/overview.service';
import { validateDto } from '../validate-dto';
import {
  ConsultationDto,
  RegistrationDto,
} from '../../../hospital/dto/hospital.dto';
import { ClinicalTool } from '../tool-registry';

const patientId = z.string().describe('Patient ID, e.g. P1001');

export function buildSchedulingTools(d: {
  hospital: HospitalService;
  lifecycle: HospitalLifecycleService;
  overview: OverviewService;
}): ClinicalTool[] {
  return [
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
      requires: { openVisit: true, patientBound: true },
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
      requires: { patientBound: true },
      async run(i) {
        return {
          success: true,
          task: await d.lifecycle.createTask(i),
        };
      },
    },
    {
      name: 'registerOpPatient',
      description:
        'Register a new outpatient and open their first visit (creates the chart, syncs to FHIR, indexes for search). Fails with possibleMatches if the patient may already exist; then show those to the user instead of registering again. Only call after the user has confirmed all details.',
      inputSchema: z.object({
        name: z.string().min(2),
        age: z.number().int().min(0).max(130),
        gender: z.enum(['male', 'female', 'other']),
        phone: z.string(),
        bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
        chiefComplaint: z.string().optional(),
      }),
      roles: ['RECEPTIONIST', 'ADMIN'],
      run: async (i, { user }) =>
        d.lifecycle.registerOutpatient(
          await validateDto(RegistrationDto, {
            ...i,
            gender: String(i.gender).toLowerCase(),
          }),
          user,
        ),
    },
    {
      name: 'recordDoctorConsultation',
      description:
        'Record a consultation (diagnosis, prescriptions, notes). Runs the medication safety shield; a CRITICAL_BLOCK result is returned as an error. Only call after the doctor has confirmed the content.',
      inputSchema: z.object({
        patientId: z.string(),
        diagnosis: z.string().min(2),
        prescriptions: z.array(z.string()).default([]),
        notes: z.string().min(1),
      }),
      roles: ['DOCTOR', 'ADMIN'],
      requires: { openVisit: true, patientBound: true },
      run: async (i, { user }) =>
        d.lifecycle.recordDoctorConsultation(
          await validateDto(ConsultationDto, i),
          user,
        ),
    },
    {
      name: 'checkUnconsultedAlerts',
      description:
        'List patients waiting for a doctor longer than the policy limit.',
      inputSchema: z.object({}),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'],
      run: () => d.lifecycle.checkUnconsultedPatientAlerts(),
    },
  ];
}
