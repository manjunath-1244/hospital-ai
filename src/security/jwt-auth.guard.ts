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
    if (required?.length && !required.includes(user.role)) {
      throw new ForbiddenException(
        `Role '${user.role}' may not access this resource`,
      );
    }
    return true;
  }
}
