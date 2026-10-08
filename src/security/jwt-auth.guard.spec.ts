import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY, ROLES_KEY } from './roles.decorator';

function ctx(headers: Record<string, string>, meta: Record<string, unknown>) {
  const req: any = { headers };
  const context = {
    getType: () => 'http',
    getHandler: () => 'h',
    getClass: () => 'c',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;
  return { req, context, reflector };
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: 'x'.repeat(40) });

  it('lets @Public routes through', async () => {
    const { context, reflector } = ctx({}, { [IS_PUBLIC_KEY]: true });
    await expect(
      new JwtAuthGuard(reflector, jwt).canActivate(context),
    ).resolves.toBe(true);
  });

  it('rejects missing, garbage and role-spoofing headers (the old header-sniffing bug)', async () => {
    for (const authorization of [
      undefined,
      'Bearer garbage',
      'Bearer mock-doctor-token',
      'doctor',
    ]) {
      const { context, reflector } = ctx(
        authorization ? { authorization } : {},
        {},
      );
      await expect(
        new JwtAuthGuard(reflector, jwt).canActivate(context),
      ).rejects.toThrow(UnauthorizedException);
    }
  });

  it('rejects tokens signed with another secret', async () => {
    const forged = await new JwtService({ secret: 'y'.repeat(40) }).signAsync({
      sub: 'u',
      name: 'n',
      role: 'ADMIN',
    });
    const { context, reflector } = ctx(
      { authorization: `Bearer ${forged}` },
      {},
    );
    await expect(
      new JwtAuthGuard(reflector, jwt).canActivate(context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('enforces roles and exposes the user', async () => {
    const token = await jwt.signAsync({
      sub: 'u1',
      name: 'Kelly',
      role: 'NURSE',
    });
    const ok = ctx(
      { authorization: `Bearer ${token}` },
      { [ROLES_KEY]: ['NURSE'] },
    );
    await expect(
      new JwtAuthGuard(ok.reflector, jwt).canActivate(ok.context),
    ).resolves.toBe(true);
    expect(ok.req.user).toEqual({
      userId: 'u1',
      userName: 'Kelly',
      role: 'NURSE',
    });

    const denied = ctx(
      { authorization: `Bearer ${token}` },
      { [ROLES_KEY]: ['ADMIN'] },
    );
    await expect(
      new JwtAuthGuard(denied.reflector, jwt).canActivate(denied.context),
    ).rejects.toThrow(ForbiddenException);
  });
});
