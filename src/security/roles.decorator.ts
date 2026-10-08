import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const IS_PUBLIC_KEY = 'isPublic';

export const USER_ROLES = [
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'ADMIN',
  'CARE_COORDINATOR',
  'PHARMACIST',
  'RADIOLOGIST',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Roles allowed to call a handler. Handlers without @Roles are reachable by any authenticated user. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Opt a handler out of authentication. Everything else is protected by the global guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
