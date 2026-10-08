import { z } from 'zod';
import { validateDto } from './validate-dto';
import {
  ConsultationDto,
  RegistrationDto,
} from '../../hospital/dto/hospital.dto';
import {
  looseBool,
  looseEnum,
  looseInt,
  looseNumber,
  looseStringList,
} from './loose-schema';
import { HospitalLifecycleService } from '../../hospital/hospital-lifecycle.service';
import { HospitalService } from '../../hospital/hospital.service';
import { News2Service } from '../../hospital/news2.service';
import { MedicationSafetyService } from '../../hospital/medication-safety.service';
import { ClinicalTool } from './tool-registry';

export function buildLifecycleTools(d: {
  lifecycle: HospitalLifecycleService;
  hospital: HospitalService;
  news2: News2Service;
  medSafety: MedicationSafetyService;
}): ClinicalTool[] {
  return [
    {
      name: 'registerOpPatient',
      description:
        'Register a new outpatient (creates the chart, syncs to FHIR, indexes for search). Only call after the user has confirmed all details.',
      inputSchema: z.object({
        name: z.string().min(2),
        age: looseInt({ min: 0, max: 130 }),
        gender: z.enum(['male', 'female', 'other']),
        phone: z.string(),
        bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
        chiefComplaint: z.string().optional(),
      }),
      roles: ['RECEPTIONIST', 'ADMIN'],
      run: async (i) =>
        d.lifecycle.registerOutpatient(
          await validateDto(RegistrationDto, {
            ...i,
            gender: String(i.gender).toLowerCase(),
          }),
        ),
    },
    {
      name: 'recordDoctorConsultation',
      description:
        'Record a consultation (diagnosis, prescriptions, notes). Runs the medication safety shield; a CRITICAL_BLOCK result is returned as an error. Only call after the doctor has confirmed the content.',
      inputSchema: z.object({
        patientId: z.string(),
        diagnosis: z.string().min(2),
        prescriptions: looseStringList(),
        notes: z.string().min(1),
      }),
      roles: ['DOCTOR', 'ADMIN'],
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
