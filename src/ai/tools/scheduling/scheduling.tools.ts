import { z } from 'zod';
import { HospitalService } from '../../../hospital/hospital.service';
import { HospitalLifecycleService } from '../../../hospital/hospital-lifecycle.service';
import { OverviewService } from '../../../hospital/overview.service';
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
      name: 'checkUnconsultedAlerts',
      description:
        'List patients waiting for a doctor longer than the policy limit.',
      inputSchema: z.object({}),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'],
      run: () => d.lifecycle.checkUnconsultedPatientAlerts(),
    },
  ];
}
