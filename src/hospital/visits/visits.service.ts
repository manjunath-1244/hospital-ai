import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { VisitEntity } from '../../database/entities/visit.entity';
import { VisitEventEntity } from '../../database/entities/visit-event.entity';
import { newId } from '../../common/ids';
import type { AuthUser } from '../../security/auth-user';
import {
  ACTIVE_STATUSES,
  VisitOutcome,
  VisitStatus,
  WAITING_STATUSES,
  isActiveStatus,
} from './visit-status';
import { checkTransition } from './visit-transitions';

/** Which outcome a finished visit gets by default when the actor does not specify one. */
const DEFAULT_OUTCOME: Partial<Record<VisitStatus, VisitOutcome>> = {
  COMPLETED: 'DISCHARGED',
  CANCELLED: 'CANCELLED',
  LEFT_WITHOUT_SEEN: 'LEFT_WITHOUT_SEEN',
};

export interface TransitionOptions {
  note?: string;
  outcome?: VisitOutcome;
  /** Pass the open transaction's manager when the status change must commit together with other writes. */
  manager?: EntityManager;
}

/**
 * Owns the lifecycle of visits. EVERY status change in the system goes through `transition()`, which consults the
 * rule table in `visit-transitions.ts`, stamps the right timestamps, records the timeline event and returns the
 * updated visit. Nothing else writes `visits.status`.
 */
@Injectable()
export class VisitsService {
  constructor(
    @InjectRepository(VisitEntity)
    private readonly visits: Repository<VisitEntity>,
    @InjectRepository(VisitEventEntity)
    private readonly events: Repository<VisitEventEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private repo(manager?: EntityManager) {
    return manager ? manager.getRepository(VisitEntity) : this.visits;
  }

  // ---- reads ----------------------------------------------------------------------------------------------------

  async get(visitId: string): Promise<VisitEntity> {
    const v = await this.visits.findOne({ where: { id: visitId } });
    if (!v) throw new NotFoundException(`Visit ${visitId} not found`);
    return v;
  }

  getActive(
    patientId: string,
    manager?: EntityManager,
  ): Promise<VisitEntity | null> {
    return this.repo(manager).findOne({
      where: {
        patientId: patientId.toUpperCase(),
        status: In([...ACTIVE_STATUSES]),
      },
    });
  }

  /** The visit that clinical records must be attached to. 409 with guidance when the patient has none. */
  async requireActive(
    patientId: string,
    manager?: EntityManager,
  ): Promise<VisitEntity> {
    const v = await this.getActive(patientId, manager);
    if (!v) {
      throw new ConflictException(
        `Patient ${patientId.toUpperCase()} has no open visit. Start a new visit (reception) or reopen the last one before recording new data.`,
      );
    }
    return v;
  }

  /** Most recent visit of each patient (open one if any, otherwise the latest finished). */
  async latestForPatients(
    patientIds: string[],
  ): Promise<Map<string, VisitEntity>> {
    if (!patientIds.length) return new Map();
    const rows = await this.visits
      .createQueryBuilder('v')
      .distinctOn(['v.patientId'])
      .where('v."patientId" IN (:...ids)', { ids: patientIds })
      .orderBy('v."patientId"')
      .addOrderBy('v."arrivedAt"', 'DESC')
      .getMany();
    return new Map(rows.map((v) => [v.patientId, v]));
  }

  listForPatient(patientId: string, limit = 20) {
    return this.visits.find({
      where: { patientId: patientId.toUpperCase() },
      order: { arrivedAt: 'DESC' },
      take: limit,
    });
  }

  /** Visits in the given statuses, oldest arrival first (a work queue). */
  listByStatus(statuses: readonly VisitStatus[], limit = 100) {
    return this.visits.find({
      where: { status: In([...statuses]) },
      order: { arrivedAt: 'ASC' },
      take: limit,
    });
  }

  timeline(visitId: string) {
    return this.events.find({ where: { visitId }, order: { at: 'ASC' } });
  }

  /** Visits still in the waiting room for longer than `minutes` (optionally only those not yet alerted). */
  findWaitingLongerThan(minutes: number, onlyUnalerted = false) {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const qb = this.visits
      .createQueryBuilder('v')
      .where('v.status IN (:...waiting)', { waiting: [...WAITING_STATUSES] })
      .andWhere('v."arrivedAt" < :cutoff', { cutoff })
      .orderBy('v."arrivedAt"', 'ASC');
    if (onlyUnalerted) qb.andWhere('v."waitAlertedAt" IS NULL');
    return qb.getMany();
  }

  async markWaitAlerted(visitIds: string[]) {
    if (!visitIds.length) return;
    await this.visits.update(
      { id: In(visitIds) },
      { waitAlertedAt: new Date() },
    );
  }

  // ---- writes ---------------------------------------------------------------------------------------------------

  /** Opens a new visit in the waiting room. A patient can have only one open visit. */
  async start(
    patientId: string,
    input: { chiefComplaint?: string | null; actor: AuthUser },
    manager?: EntityManager,
  ): Promise<VisitEntity> {
    const pid = patientId.toUpperCase();
    const open = await this.getActive(pid, manager);
    if (open) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: `Patient ${pid} already has an open visit (${open.id}, ${open.status}).`,
        openVisitId: open.id,
      });
    }
    const run = async (m: EntityManager) => {
      const visit = await m.save(
        VisitEntity,
        m.create(VisitEntity, {
          id: newId('V', 7),
          patientId: pid,
          status: 'WAITING_TRIAGE',
          chiefComplaint: input.chiefComplaint?.trim() || null,
          priority: null,
          department: null,
          primaryDoctorId: null,
          primaryDoctorName: null,
          triagedAt: null,
          consultationStartedAt: null,
          completedAt: null,
          waitAlertedAt: null,
          outcome: null,
          closeReason: null,
          createdBy: input.actor.userName,
        }),
      );
      await m.save(
        VisitEventEntity,
        this.eventFor(visit.id, null, 'WAITING_TRIAGE', input.actor),
      );
      return visit;
    };
    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  /**
   * The ONLY way a visit changes status. Throws 409 (impossible move), 403 (role not allowed) or 400 (reason missing).
   * Idempotent for workflow steps: asking for the status the visit already has is a no-op.
   */
  async transition(
    visit: VisitEntity | string,
    to: VisitStatus,
    actor: AuthUser,
    opts: TransitionOptions = {},
  ): Promise<VisitEntity> {
    const run = async (m: EntityManager) => {
      const visitId = typeof visit === 'string' ? visit : visit.id;
      const current = await m.findOne(VisitEntity, {
        where: { id: visitId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current)
        throw new NotFoundException(
          `Visit ${typeof visit === 'string' ? visit : visit.id} not found`,
        );
      if (current.status === to) return current;

      const verdict = checkTransition(
        current.status,
        to,
        actor.role,
        opts.note,
      );
      if (!verdict.ok) {
        if (verdict.kind === 'ROLE')
          throw new ForbiddenException(verdict.message);
        if (verdict.kind === 'NOTE')
          throw new BadRequestException(verdict.message);
        throw new ConflictException(verdict.message);
      }

      const from = current.status;
      const now = new Date();
      current.status = to;
      if (to === 'TRIAGED') current.triagedAt = current.triagedAt ?? now;
      if (to === 'IN_CONSULTATION' && !current.consultationStartedAt) {
        current.consultationStartedAt = now;
        if (actor.role === 'DOCTOR') {
          current.primaryDoctorId = current.primaryDoctorId ?? actor.userId;
          current.primaryDoctorName =
            current.primaryDoctorName ?? actor.userName;
        }
      }
      if (!isActiveStatus(to)) {
        current.completedAt = now;
        current.outcome =
          opts.outcome ?? DEFAULT_OUTCOME[to] ?? 'CLOSED_BY_STAFF';
        current.closeReason = opts.note?.trim() || current.closeReason;
      } else if (!isActiveStatus(from)) {
        // reopening a finished visit
        current.completedAt = null;
        current.outcome = null;
        current.closeReason = opts.note?.trim() || null;
        current.waitAlertedAt = null;
      }
      const saved = await m.save(VisitEntity, current);
      await m.save(
        VisitEventEntity,
        this.eventFor(saved.id, from, to, actor, opts.note),
      );
      return saved;
    };
    return opts.manager ? run(opts.manager) : this.dataSource.transaction(run);
  }

  /** Sets the urgency the nurse assigned at triage. Not a status change, so it records no timeline event. */
  async setPriority(
    visitId: string,
    priority: number,
    manager?: EntityManager,
  ) {
    await this.repo(manager).update({ id: visitId }, { priority });
  }

  async setChiefComplaint(
    visitId: string,
    text: string,
    manager?: EntityManager,
  ) {
    await this.repo(manager).update(
      { id: visitId },
      { chiefComplaint: text.trim() || null },
    );
  }

  /** Part of the patient delete: remove every visit and its timeline (inside the caller's transaction). */
  async deleteForPatient(
    patientId: string,
    manager: EntityManager,
  ): Promise<number> {
    const ids = (
      await manager.find(VisitEntity, {
        where: { patientId },
        select: { id: true },
      })
    ).map((v) => v.id);
    if (!ids.length) return 0;
    await manager.delete(VisitEventEntity, { visitId: In(ids) });
    return (await manager.delete(VisitEntity, { patientId })).affected ?? 0;
  }

  private eventFor(
    visitId: string,
    from: VisitStatus | null,
    to: VisitStatus,
    actor: AuthUser,
    note?: string,
  ): Partial<VisitEventEntity> {
    return {
      visitId,
      fromStatus: from,
      toStatus: to,
      actorId: actor.userId,
      actorName: actor.userName,
      actorRole: actor.role,
      note: note?.trim() || null,
    };
  }
}
