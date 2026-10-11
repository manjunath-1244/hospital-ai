import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable, tap } from 'rxjs';
import { AuditLogEntity } from '../database/entities/audit-log.entity';

/**
 * ============================================================================
 * 📜 CONCEPT: HIPAA Access Audit & Non-Repudiation Logging Interceptor
 * ============================================================================
 * WHAT IT IS:
 * Enterprise interceptor implementing the HIPAA §164.312(b) Audit Controls standard,
 * recording an immutable ledger of every healthcare worker who accesses or mutates
 * protected patient records.
 *
 * HOW IMPLEMENTED:
 * - Request Pipeline Interception:
 *   Intercepts all HTTP mutations via NestJS `NestInterceptor` and RxJS `tap()`.
 * - Forensic Ledger (`AuditLogEntity`):
 *   Extracts the authenticated user ID, clinical role, HTTP method, URL endpoint,
 *   associated patient ID, and response status code.
 * - Non-Blocking Asynchronous Persistence:
 *   Writes audit rows asynchronously so logging never delays clinician requests or
 *   causes transaction rollbacks.
 *
 * USE CASE:
 * Delivers non-repudiation forensic evidence required during regulatory HIPAA audits,
 * medical malpractice inquiries, and hospital compliance investigations.
 * ============================================================================
 * Records who touched which patient record (HIPAA-style access audit). Never blocks or fails the request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly repo: Repository<AuditLogEntity>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const record = (statusCode: number) => {
      const user = req.user;
      if (!user) return; // unauthenticated traffic (login, health) is not PHI access
      const path = String(req.originalUrl ?? req.url).split('?')[0];
      const patientId =
        req.params?.id && path.includes('/patients/')
          ? req.params.id
          : (req.body?.patientId ?? null);
      this.repo
        .save({
          userId: user.userId,
          role: user.role,
          method: req.method,
          path,
          patientId:
            typeof patientId === 'string' ? patientId.toUpperCase() : null,
          statusCode,
        })
        .catch((err: Error) =>
          this.logger.warn(`audit write failed: ${err.message}`),
        );
    };

    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode),
        error: (err) =>
          record(typeof err?.getStatus === 'function' ? err.getStatus() : 500),
      }),
    );
  }
}
