import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY, ROLES_KEY, UserRole } from './roles.decorator';
import { AuthUser } from './auth-user';

export interface JwtPayload {
  sub: string;
  name: string;
  role: UserRole;
}

/**
 * ============================================================================
 * 🔐 CONCEPT: Security (Role-Based Access Control & JWT Authentication)
 * ============================================================================
 * WHAT IT IS:
 * Perimeter and route-level authorization security that authenticates hospital
 * staff and enforces strict Role-Based Access Control (RBAC) across all REST
 * endpoints, WebSocket connections, and AI agent capabilities.
 *
 * HOW IMPLEMENTED:
 * - JWT Verification: Verifies cryptographically signed JSON Web Tokens (sub, role, name)
 *   on every inbound HTTP request (except routes explicitly decorated with `@Public()`).
 * - `@Roles(...)` Reflection: Intercepts requests using NestJS `Reflector` to ensure
 *   the authenticated user's role (`DOCTOR`, `NURSE`, `RECEPTIONIST`, `BILLING`, etc.)
 *   matches required endpoint permissions.
 * - Global Guard Injection: Registered as `APP_GUARD` in `AppModule`.
 *
 * USE CASE:
 * Prevents unauthorized access to clinical patient records, ensuring staff only
 * view and execute actions permitted by their medical license and hospital credentials.
 * ============================================================================
 * Global guard: verifies the signed JWT on every non-@Public route and enforces @Roles.
 * Routes without @Roles are available to any authenticated user.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    const token = header?.startsWith('Bearer ')
      ? header.slice(7).trim()
      : undefined;
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user: AuthUser = {
      userId: payload.sub,
      userName: payload.name,
      role: payload.role,
    };
    request.user = user;

    const required = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      targets,
    );
    if (
      required?.length &&
      !required.includes(user.role) &&
      user.role !== 'ADMIN'
    ) {
      throw new ForbiddenException(
        `Role '${user.role}' may not access this resource`,
      );
    }
    return true;
  }
}
