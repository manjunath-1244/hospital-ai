import { z } from 'zod';
import { ClinicalTool, ToolRunContext } from '../tool-registry';
import type { SpecialistService } from '../../../hospital/specialists/specialist.service';
import type { VisitsService } from '../../../hospital/visits/visits.service';
import type { FollowUpService } from '../../../hospital/followup/follow-up.service';

/** Saves a proposal for human approval (ActionProposalService). Absent in unit tests: the tool then only returns the proposal. */
export type ProposalSaver = (
  input: { type: string; payload: Record<string, any> },
  ctx: ToolRunContext,
) => Promise<{ id: string; summary: string; tier: string; expiresAt: Date }>;

/** Persists a proposal when a saver is wired, and says plainly that nothing has happened yet. */
async function finish(
  save: ProposalSaver | undefined,
  type: string,
  base: {
    proposalType: string;
    proposedAction: Record<string, any>;
    message: string;
  },
  ctx: ToolRunContext,
) {
  if (!save)
    return {
      success: true,
      status: 'PROPOSED',
      requiresApproval: true,
      ...base,
    };
  let saved;
  try {
    saved = await save({ type, payload: base.proposedAction }, ctx);
  } catch (err: any) {
    // A proposal that cannot work is reported to the model as a failure with what is missing or what to offer instead:
    // no card is created and nothing is promised to the user.
    const body = err?.response ?? {};
    return {
      success: false,
      error: String(
        body.message ?? err?.message ?? 'The proposal was rejected',
      ),
      ...(body.needs ? { needs: body.needs } : {}),
      ...(body.suggestions ? { suggestions: body.suggestions } : {}),
      ...(body.possibleMatches
        ? { possibleMatches: body.possibleMatches }
        : {}),
    };
  }
  const waiting = saved.status === 'PENDING';
  return {
    success: true,
    proposalType: base.proposalType,
    status: waiting ? 'PENDING_APPROVAL' : saved.status,
    actionId: saved.id,
    summary: saved.summary,
    tier: saved.tier,
    expiresAt: saved.expiresAt,
    requiresApproval: waiting,
    proposedAction: base.proposedAction,
    message: waiting
      ? `Proposal ${saved.id} is saved and WAITING for the user to approve it in the approval card. NOTHING has been done yet; do not say it is done.`
      : `An identical request (${saved.id}) was already ${saved.status}. Tell the user exactly that; do not claim a new action.`,
  };
}

const patientId = z.string().describe('Patient ID, e.g. P1001');

/**
 * Proposal tools: return structured proposal objects ONLY.
 * Never perform direct database writes or side effects.
 * Every proposal requires approval through the human approval layer (W6).
 */
export interface ProposeDeps {
  save?: ProposalSaver;
  specialists?: SpecialistService;
  visits?: VisitsService;
  followUp?: FollowUpService;
}

export function buildProposeTools(deps: ProposeDeps = {}): ClinicalTool[] {
  const { save, specialists, visits, followUp } = deps;
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
              field: z
                .string()
                .describe('Clinical data field, e.g. NEWS2 score, Troponin'),
              value: z.string().describe('Value observed, e.g. 6, 0.45 ng/mL'),
              source: z
                .string()
                .describe('Source, e.g. Current Vitals, Lab Results'),
            }),
          )
          .optional()
          .describe('Supporting evidence from context'),
      }),
      roles: ['DOCTOR', 'NURSE', 'ADMIN'],
      requires: { openVisit: true, patientBound: true },
      async run(i, ctx) {
        return finish(
          save,
          'REFERRAL',
          {
            proposalType: 'REFERRAL',
            proposedAction: {
              patientId: i.patientId,
              specialty: i.specialty,
              assignedSpecialistId: i.assignedSpecialistId ?? null,
              urgency: i.urgency,
              reason: i.reason,
              evidence: i.evidence ?? [],
            },
            message: `Referral proposal for ${i.specialty} created. Human doctor approval required before consultation request is issued.`,
          },
          ctx,
        );
      },
    },
    {
      name: 'proposeFollowUp',
      description:
        "Prepare the follow-up plan for the patient's open visit: it is BUILT FROM what the specialist/doctor recorded (appointment with the specialist, repeat tests, coordinator task, patient notice) and saved as ONE proposal for approval. Needs a recorded specialist assessment or consultation; otherwise it says what is missing. Does not write anything until the user approves.",
      inputSchema: z.object({ patientId }),
      roles: ['DOCTOR', 'NURSE', 'ADMIN', 'CARE_COORDINATOR'],
      requires: { openVisit: true, patientBound: true },
      async run(i, ctx) {
        if (!followUp || !visits)
          return {
            success: false,
            error: 'Follow-up planning is not available.',
          };
        try {
          const visit = await visits.getActive(i.patientId);
          if (!visit)
            return {
              success: false,
              error: `Patient ${i.patientId} has no open visit.`,
            };
          const { plan, proposalAction } = await followUp.generateProposal(
            visit.id,
            ctx.user,
            {
              threadId: ctx.threadId ?? undefined,
              traceId: ctx.traceId,
            },
          );
          return {
            success: true,
            proposalType: 'FOLLOW_UP',
            status: 'PENDING_APPROVAL',
            actionId: proposalAction.id,
            summary: proposalAction.summary,
            tier: proposalAction.tier,
            expiresAt: proposalAction.expiresAt,
            requiresApproval: true,
            proposedAction: {
              planId: plan.id,
              patientId: plan.patientId,
              items: plan.items.map((x) => x.summary),
            },
            message: `Follow-up plan ${plan.id} (${plan.items.length} items) is saved as proposal ${proposalAction.id} and WAITING for approval. NOTHING has been done yet; do not say it is done.`,
          };
        } catch (err: any) {
          const body = err?.response ?? {};
          return {
            success: false,
            error: String(
              body.message ?? err?.message ?? 'Could not prepare the plan',
            ),
          };
        }
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
          .describe(
            'Role or user ID to assign, e.g. NURSE, RECEPTIONIST, Dr. Wilson',
          ),
        patientId: patientId.optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
        notes: z.string().optional(),
      }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      requires: { patientBound: true },
      async run(i, ctx) {
        return finish(
          save,
          'STAFF_TASK',
          {
            proposalType: 'STAFF_TASK',
            proposedAction: {
              title: i.title,
              assignedToRole: i.assignedToRole,
              patientId: i.patientId ?? null,
              priority: i.priority,
              notes: i.notes ?? null,
            },
            message:
              'Staff task proposal created. Requires approval before assignment.',
          },
          ctx,
        );
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
          .describe(
            'User ID, role name (e.g. CARDIOLOGY_SPECIALIST), or patient ID',
          ),
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
      async run(i, ctx) {
        return finish(
          save,
          'NOTIFICATION',
          {
            proposalType: 'NOTIFICATION',
            proposedAction: {
              recipientType: i.recipientType,
              recipientTarget: i.recipientTarget,
              notificationType: i.notificationType,
              message: i.message,
              patientId: i.patientId ?? null,
            },
            message:
              'Notification proposal created. Approval required before dispatch.',
          },
          ctx,
        );
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
          .describe(
            'Name of lab test or diagnostic test, e.g. Troponin I, ECG 12-lead',
          ),
        urgency: z.enum(['STAT', 'URGENT', 'ROUTINE']).default('ROUTINE'),
        clinicalIndication: z
          .string()
          .min(3)
          .describe('Reason for ordering test'),
      }),
      roles: ['DOCTOR', 'NURSE', 'ADMIN'],
      requires: { openVisit: true, patientBound: true },
      async run(i, ctx) {
        return finish(
          save,
          'LAB_ORDER',
          {
            proposalType: 'LAB_ORDER',
            proposedAction: {
              patientId: i.patientId,
              testName: i.testName,
              urgency: i.urgency,
              clinicalIndication: i.clinicalIndication,
            },
            message: 'Lab order proposal created. Doctor sign-off required.',
          },
          ctx,
        );
      },
    },
    {
      name: 'proposeAppointment',
      description:
        'Propose booking an appointment with a REAL specialist at a REAL free slot. Give the specialist (doctorId from findSpecialists) and an ISO date-time taken from getSpecialistAvailability. If something is missing or the slot is not free, this returns what is missing and the next free slots: ask the user. Saved for approval; nothing is booked until they approve.',
      inputSchema: z.object({
        patientId,
        doctorId: z
          .string()
          .optional()
          .describe('Doctor account id from findSpecialists'),
        specialty: z
          .string()
          .optional()
          .describe('Used to find the doctor when doctorId is not known'),
        dateTime: z
          .string()
          .optional()
          .describe('ISO 8601 slot start from getSpecialistAvailability'),
        reason: z.string().optional(),
      }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'],
      requires: { openVisit: true, patientBound: true },
      async run(i, ctx) {
        let doctorId = i.doctorId;
        if (!doctorId && i.specialty && specialists) {
          const found = await specialists.find({
            specialty: i.specialty,
            onlyAvailable: true,
          });
          if (found.length === 1) doctorId = found[0].id;
          else if (found.length > 1)
            return {
              success: false,
              error: `Several ${i.specialty} specialists are available; which one?`,
              needs: ['doctorId'],
              suggestions: {
                specialists: found.map((f) => ({ id: f.id, name: f.name })),
              },
            };
        }
        if (doctorId && !i.dateTime && specialists) {
          const free = await specialists
            .getAvailability(doctorId, { limit: 5 })
            .catch(() => ({ slots: [] as string[] }));
          return {
            success: false,
            error: 'Which time should I book?',
            needs: ['dateTime'],
            suggestions: { nextFreeSlots: free.slots },
          };
        }
        let reason = i.reason;
        if (!reason && visits)
          reason =
            (await visits.getActive(i.patientId))?.chiefComplaint ??
            'Follow-up appointment';
        return finish(
          save,
          'APPOINTMENT',
          {
            proposalType: 'APPOINTMENT',
            proposedAction: {
              patientId: i.patientId,
              doctorId,
              dateTime: i.dateTime,
              reason,
            },
            message:
              'Appointment proposal created. Requires approval before it is booked.',
          },
          ctx,
        );
      },
    },
    {
      name: 'proposeRegistration',
      description:
        'Propose registering a NEW patient (and opening their first visit). If the person may already be registered this returns the possible matches: show them to the user and only propose again with allowDuplicate=true if the user confirms it is a different person. Saved for approval; nothing is registered until they approve.',
      inputSchema: z.object({
        name: z.string().min(2),
        age: z.number().int().min(0).max(130).optional(),
        dob: z.string().optional().describe('YYYY-MM-DD'),
        gender: z.enum(['male', 'female', 'other']),
        phone: z.string(),
        bloodType: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
        chiefComplaint: z.string().optional(),
        allowDuplicate: z.boolean().optional(),
      }),
      roles: ['RECEPTIONIST', 'ADMIN'],
      async run(i, ctx) {
        return finish(
          save,
          'REGISTER_PATIENT',
          {
            proposalType: 'REGISTER_PATIENT',
            proposedAction: { ...i, gender: String(i.gender).toLowerCase() },
            message:
              'Registration proposal created. Requires approval before the patient is created.',
          },
          ctx,
        );
      },
    },
    {
      name: 'proposeConsultation',
      description:
        "Propose recording a doctor's consultation (diagnosis, prescriptions, notes). The medication safety check runs now and its findings are shown with the proposal; a CRITICAL conflict needs the doctor's written override reason when approving. Saved for the DOCTOR to approve; nothing is recorded until then.",
      inputSchema: z.object({
        patientId,
        diagnosis: z.string().min(2),
        prescriptions: z.array(z.string()).default([]),
        notes: z.string().min(1),
      }),
      roles: ['DOCTOR', 'ADMIN'],
      requires: { openVisit: true, patientBound: true },
      async run(i, ctx) {
        return finish(
          save,
          'CONSULTATION',
          {
            proposalType: 'CONSULTATION',
            proposedAction: {
              patientId: i.patientId,
              diagnosis: i.diagnosis,
              prescriptions: i.prescriptions,
              notes: i.notes,
            },
            message:
              'Consultation proposal created. The doctor must approve it (with an override note if the safety check blocks it).',
          },
          ctx,
        );
      },
    },
  ];
}
