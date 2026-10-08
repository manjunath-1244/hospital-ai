import type { NavTarget, UserRole } from '../context/RoleContext';

/** Mirrors src/database/entities/notification.entity.ts. */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  payload?: { referralId?: string; patientId?: string; visitId?: string; [k: string]: unknown } | null;
  readAt?: string | null;
  createdAt: string;
}

/** Portals that can act on a notification's referral / patient. */
const REFERRAL_PORTAL: UserRole = 'SPECIALIST';
const PATIENT_PORTAL: UserRole = 'DOCTOR';

export interface NotificationDestination {
  /** Portal an ADMIN must switch to (undefined = already in a suitable portal). */
  viewAs?: UserRole;
  nav: NavTarget;
}

/** Decide where a click goes for the current portal role; null = nothing to open in this portal. */
export function destinationFor(n: AppNotification, portal: UserRole, isAdmin: boolean): NotificationDestination | null {
  const referralId = n.payload?.referralId;
  const patientId = n.payload?.patientId;
  if (referralId) {
    if (portal === REFERRAL_PORTAL) return { nav: { referralId, patientId } };
    if (portal === PATIENT_PORTAL && patientId) return { nav: { patientId, referralId } };
    if (isAdmin) return { viewAs: REFERRAL_PORTAL, nav: { referralId, patientId } };
  }
  if (patientId) {
    if (portal === PATIENT_PORTAL) return { nav: { patientId } };
    if (isAdmin) return { viewAs: PATIENT_PORTAL, nav: { patientId } };
  }
  return null;
}
