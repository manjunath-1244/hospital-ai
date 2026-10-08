import { ActionTier } from '../../database/entities/agent-action.entity';
import type { UserRole } from '../../security/roles.decorator';

export interface ActionDefinition {
  type: string;
  tier: ActionTier;
  rolesAllowed: UserRole[];
  expiresInMinutes: number;
  requiresOpenVisit?: boolean;
}

export const ACTION_CATALOGUE: Record<string, ActionDefinition> = {
  // AUTO: low risk, reversible, no clinical impact
  COMPUTE_NEWS2: {
    type: 'COMPUTE_NEWS2',
    tier: 'AUTO',
    rolesAllowed: ['DOCTOR', 'NURSE', 'ADMIN'],
    expiresInMinutes: 60,
  },
  CREATE_SELF_TASK: {
    type: 'CREATE_SELF_TASK',
    tier: 'AUTO',
    rolesAllowed: [
      'DOCTOR',
      'NURSE',
      'RECEPTIONIST',
      'CARE_COORDINATOR',
      'ADMIN',
    ],
    expiresInMinutes: 1440,
  },

  // ASK: requires 1 Approve click by user
  REFERRAL: {
    type: 'REFERRAL',
    tier: 'ASK',
    rolesAllowed: ['DOCTOR', 'NURSE', 'ADMIN'],
    expiresInMinutes: 1440,
    requiresOpenVisit: true,
  },
  APPOINTMENT: {
    type: 'APPOINTMENT',
    tier: 'ASK',
    rolesAllowed: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'],
    expiresInMinutes: 120,
    requiresOpenVisit: true,
  },
  REGISTER_PATIENT: {
    type: 'REGISTER_PATIENT',
    tier: 'ASK',
    rolesAllowed: ['RECEPTIONIST', 'ADMIN'],
    expiresInMinutes: 60,
  },
  STAFF_TASK: {
    type: 'STAFF_TASK',
    tier: 'ASK',
    rolesAllowed: [
      'DOCTOR',
      'NURSE',
      'RECEPTIONIST',
      'CARE_COORDINATOR',
      'ADMIN',
    ],
    expiresInMinutes: 1440,
  },
  LAB_ORDER: {
    type: 'LAB_ORDER',
    tier: 'ASK',
    rolesAllowed: ['DOCTOR', 'NURSE', 'ADMIN'],
    expiresInMinutes: 1440,
    requiresOpenVisit: true,
  },
  NOTIFICATION: {
    type: 'NOTIFICATION',
    tier: 'ASK',
    rolesAllowed: [
      'DOCTOR',
      'NURSE',
      'RECEPTIONIST',
      'CARE_COORDINATOR',
      'ADMIN',
    ],
    expiresInMinutes: 1440,
  },
  FOLLOW_UP: {
    type: 'FOLLOW_UP',
    tier: 'ASK',
    rolesAllowed: ['DOCTOR', 'NURSE', 'ADMIN', 'CARE_COORDINATOR'],
    expiresInMinutes: 1440,
    requiresOpenVisit: true,
  },
  CLOSE_VISIT: {
    type: 'CLOSE_VISIT',
    tier: 'ASK',
    rolesAllowed: ['DOCTOR', 'ADMIN'],
    expiresInMinutes: 60,
    requiresOpenVisit: true,
  },
  REOPEN_VISIT: {
    type: 'REOPEN_VISIT',
    tier: 'ASK',
    rolesAllowed: ['DOCTOR', 'ADMIN'],
    expiresInMinutes: 60,
  },

  // ASK_HUMAN: requires human override / input
  CONSULTATION: {
    type: 'CONSULTATION',
    tier: 'ASK_HUMAN',
    rolesAllowed: ['DOCTOR', 'ADMIN'],
    expiresInMinutes: 1440,
    requiresOpenVisit: true,
  },

  // NEVER: agent cannot propose or execute
  DELETE_PATIENT: {
    type: 'DELETE_PATIENT',
    tier: 'NEVER',
    rolesAllowed: [],
    expiresInMinutes: 0,
  },
  MODIFY_ROLES: {
    type: 'MODIFY_ROLES',
    tier: 'NEVER',
    rolesAllowed: [],
    expiresInMinutes: 0,
  },
  DELETE_KNOWLEDGE: {
    type: 'DELETE_KNOWLEDGE',
    tier: 'NEVER',
    rolesAllowed: [],
    expiresInMinutes: 0,
  },
};

export function getActionTier(type: string): ActionTier {
  const def = ACTION_CATALOGUE[type.toUpperCase()];
  return def ? def.tier : 'ASK';
}

export function canProposeAction(type: string, role: UserRole): boolean {
  const def = ACTION_CATALOGUE[type.toUpperCase()];
  if (!def || def.tier === 'NEVER') return false;
  return def.rolesAllowed.includes(role);
}

export function canApproveAction(type: string, role: UserRole): boolean {
  const def = ACTION_CATALOGUE[type.toUpperCase()];
  if (!def || def.tier === 'NEVER') return false;
  return def.rolesAllowed.includes(role);
}

/** Render a deterministic, human-readable summary strictly from payload values. */
export function renderActionSummary(
  type: string,
  payload: Record<string, any>,
): string {
  switch (type.toUpperCase()) {
    case 'REFERRAL':
      return `Referral proposal to ${payload.specialty ?? 'Specialist'} for patient ${payload.patientId} (Urgency: ${payload.urgency ?? 'ROUTINE'})`;
    case 'APPOINTMENT':
      return `Book appointment for patient ${payload.patientId} on ${payload.dateTime} with ${payload.doctorName || payload.doctorId || 'Specialist'}`;
    case 'REGISTER_PATIENT':
      return `Register new patient "${payload.name}" (${payload.gender}, ${payload.age} y/o, phone: ${payload.phone})`;
    case 'STAFF_TASK':
      return `Staff task: "${payload.title}" assigned to ${payload.assignedToRole || payload.assignedTo} (Priority: ${payload.priority ?? 'MEDIUM'})`;
    case 'LAB_ORDER':
      return `Order lab test "${payload.testName}" for patient ${payload.patientId} (Urgency: ${payload.urgency ?? 'ROUTINE'})`;
    case 'NOTIFICATION':
      return `Notification to ${payload.recipientTarget} (${payload.recipientType}): "${payload.message}"`;
    case 'FOLLOW_UP':
      return `Follow-up plan for patient ${payload.patientId} (${payload.planType}, timeframe: ${payload.timeframe})`;
    case 'CONSULTATION':
      return `Record consultation for patient ${payload.patientId}: Diagnosis "${payload.diagnosis}" (${(payload.prescriptions ?? []).length} Rx)`;
    case 'CLOSE_VISIT':
      return `Complete visit ${payload.visitId ?? ''} for patient ${payload.patientId}`;
    case 'REOPEN_VISIT':
      return `Reopen visit ${payload.visitId ?? ''} for patient ${payload.patientId}`;
    default:
      return `Proposed action ${type} for patient ${payload.patientId ?? 'N/A'}`;
  }
}
