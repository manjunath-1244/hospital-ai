import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from './roles.decorator';

/** A class (not an interface) so it can appear in decorated controller signatures under isolatedModules. */
export class AuthUser {
  userId: string;
  userName: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
