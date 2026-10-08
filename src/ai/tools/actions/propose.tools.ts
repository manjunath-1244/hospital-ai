import { z } from 'zod';
import { ClinicalTool } from '../tool-registry';

const patientId = z.string().describe('Patient ID, e.g. P1001');

/**
 * Proposal tools: return structured proposal objects ONLY.
 * Never perform direct database writes or side effects.
 * Every proposal requires approval through the human approval layer (W6).
 */
export function buildProposeTools(): ClinicalTool[] {
  return [
    {
      name: 'proposeReferral',
      description:
        'Propose a specialist referral for a patient (e.g., Cardiology, Neurology). Returns a proposal object only and does NOT write to the database. Human doctor confirmation/approval is required.',
      inputSchema: z.object({
        patientId,
        specialty: z
          .string()
          .describe('Target specialty, e.g. Cardiology, Neurology'),
        assignedSpecialistId: z
          .string()
          .optional()
          .describe('Doctor ID of assigned specialist if selected'),
        urgency: z
          .enum(['ROUTINE', 'URGENT', 'EMERGENCY'])
          .default('ROUTINE')
          .describe('Urgency level'),
        reason: z.string().min(5).describe('Clinical rationale for referral'),
        evidence: z
          .array(
            z.object({
              field: z.string().describe('Clinical data field, e.g. NEWS2 score, Troponin'),
              value: z.string().describe('Value observed, e.g. 6, 0.45 ng/mL'),
              source: z.string().describe('Source, e.g. Current Vitals, Lab Results'),
            }),
          )
          .optional()
          .describe('Supporting evidence from context'),
      }),
      roles: ['DOCTOR', 'NURSE', 'ADMIN'],
      requires: { openVisit: true, patientBound: true },
      async run(i) {
        return {
          success: true,
          proposalType: 'REFERRAL',
          status: 'PROPOSED',
          proposedAction: {
            patientId: i.patientId,
            specialty: i.specialty,
            assignedSpecialistId: i.assignedSpecialistId ?? null,
            urgency: i.urgency,
            reason: i.reason,
            evidence: i.evidence ?? [],
          },
          requiresApproval: true,
          message: `Referral proposal for ${i.specialty} created. Human doctor approval required before consultation request is issued.`,
        };
      },
    },
    {
      name: 'proposeFollowUp',
      description:
        'Propose a follow-up plan for a patient (appointment, lab order, task, patient notice). Returns a proposal object only and does NOT write to the database.',
      inputSchema: z.object({
        patientId,
        planType: z.enum([
          'APPOINTMENT',
          'LAB_TEST',
          'STAFF_TASK',
          'PATIENT_NOTICE',
          'COMPREHENSIVE',
        ]),
        timeframe: z
          .string()
          .describe('Suggested timeframe, e.g. 2 weeks, 1 month, next morning'),
        instructions: z.string().min(5).describe('Detailed follow-up instructions'),
        recommendedSpecialistId: z
          .string()
          .optional()
          .describe('Optional specialist doctor ID for follow-up appointment'),
      }),
      roles: ['DOCTOR', 'NURSE', 'ADMIN', 'CARE_COORDINATOR'],
      requires: { openVisit: true, patientBound: true },
      async run(i) {
        return {
          success: true,
          proposalType: 'FOLLOW_UP',
          status: 'PROPOSED',
          proposedAction: {
            patientId: i.patientId,
            planType: i.planType,
            timeframe: i.timeframe,
            instructions: i.instructions,
            recommendedSpecialistId: i.recommendedSpecialistId ?? null,
          },
          requiresApproval: true,
          message: 'Follow-up plan proposal created. Requires doctor approval.',
        };
      },
    },
    {
      name: 'proposeTask',
      description:
        'Propose a staff task (e.g. check vitals in 1h, review lab results). Returns a proposal object only and does NOT write to the database.',
      inputSchema: z.object({
        title: z.string().min(3),
        assignedToRole: z
          .string()
          .describe('Role or user ID to assign, e.g. NURSE, RECEPTIONIST, Dr. Wilson'),
        patientId: patientId.optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
        notes: z.string().optional(),
      }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      requires: { patientBound: true },
      async run(i) {
        return {
          success: true,
          proposalType: 'STAFF_TASK',
          status: 'PROPOSED',
          proposedAction: {
            title: i.title,
            assignedToRole: i.assignedToRole,
            patientId: i.patientId ?? null,
            priority: i.priority,
            notes: i.notes ?? null,
          },
          requiresApproval: true,
          message: 'Staff task proposal created. Requires approval before assignment.',
        };
      },
    },
    {
      name: 'proposeNotification',
      description:
        'Propose a notification to staff or a patient (e.g. critical lab result alert, specialist request notice). Returns a proposal object only and does NOT send.',
      inputSchema: z.object({
        recipientType: z.enum(['USER', 'ROLE', 'PATIENT']),
        recipientTarget: z
          .string()
          .describe('User ID, role name (e.g. CARDIOLOGY_SPECIALIST), or patient ID'),
        notificationType: z.enum([
          'ALERT',
          'REFERRAL_NOTICE',
          'LAB_RESULT',
          'PATIENT_NOTICE',
          'GENERAL',
        ]),
        message: z.string().min(5).describe('Notification message text'),
        patientId: patientId.optional(),
      }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      requires: { patientBound: true },
      async run(i) {
        return {
          success: true,
          proposalType: 'NOTIFICATION',
          status: 'PROPOSED',
          proposedAction: {
            recipientType: i.recipientType,
            recipientTarget: i.recipientTarget,
            notificationType: i.notificationType,
            message: i.message,
            patientId: i.patientId ?? null,
          },
          requiresApproval: true,
          message: 'Notification proposal created. Approval required before dispatch.',
        };
      },
    },
    {
      name: 'proposeLabOrder',
      description:
        'Propose a lab order or diagnostic test for a patient (e.g., Troponin I, ECG 12-lead, CBC, CT Head). Returns a proposal object only (does NOT submit lab order).',
      inputSchema: z.object({
        patientId,
        testName: z
          .string()
          .min(2)
          .describe('Name of lab test or diagnostic test, e.g. Troponin I, ECG 12-lead'),
        urgency: z.enum(['STAT', 'URGENT', 'ROUTINE']).default('ROUTINE'),
        clinicalIndication: z.string().min(3).describe('Reason for ordering test'),
      }),
      roles: ['DOCTOR', 'NURSE', 'ADMIN'],
      requires: { openVisit: true, patientBound: true },
      async run(i) {
        return {
          success: true,
          proposalType: 'LAB_ORDER',
          status: 'PROPOSED',
          proposedAction: {
            patientId: i.patientId,
            testName: i.testName,
            urgency: i.urgency,
            clinicalIndication: i.clinicalIndication,
          },
          requiresApproval: true,
          message: 'Lab order proposal created. Doctor sign-off required.',
        };
      },
    },
  ];
}
