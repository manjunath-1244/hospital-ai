import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PatientEntity } from '../../database/entities/patient.entity';
import { VisitsService } from '../visits/visits.service';
import { isActiveStatus } from '../visits/visit-status';
import {
  ConsultationRequestEntity,
  type ReferralStatus,
  type ReferralUrgency,
} from '../../database/entities/consultation-request.entity';
import { VisitEntity } from '../../database/entities/visit.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { NotificationService } from '../notifications/notification.service';
import { HospitalEventsGateway } from '../../events/hospital-events.gateway';
import { AuthUser } from '../../security/auth-user';
import { newId } from '../../common/ids';

export class CreateReferralDto {
  @Matches(/^[A-Za-z0-9-]{2,32}$/) visitId!: string;
  @Matches(/^[A-Za-z0-9-]{2,32}$/) patientId!: string;
  @IsString() @MinLength(2) @MaxLength(80) specialty!: string;
  @IsOptional() @IsString() @MaxLength(64) assignedSpecialistId?: string;
  @IsOptional()
  @IsIn(['ROUTINE', 'URGENT', 'EMERGENCY'])
  urgency?: ReferralUrgency;
  @IsString() @MinLength(5) @MaxLength(2000) reason!: string;
  @IsOptional() @IsString() @MaxLength(4000) aiRationale?: string;
  @IsOptional() evidence?: any;
}

const ALLOWED_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  REQUESTED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @InjectRepository(ConsultationRequestEntity)
    private readonly referralRepo: Repository<ConsultationRequestEntity>,
    @InjectRepository(VisitEntity)
    private readonly visitRepo: Repository<VisitEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(PatientEntity)
    private readonly patientRepo: Repository<PatientEntity>,
    private readonly visits: VisitsService,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: HospitalEventsGateway,
  ) {}

  async createReferral(
    dto: CreateReferralDto,
    requestedBy: AuthUser,
  ): Promise<ConsultationRequestEntity> {
    const visit = await this.visitRepo.findOne({ where: { id: dto.visitId } });
    if (!visit) {
      throw new NotFoundException(`Visit ${dto.visitId} not found`);
    }
    const patientId = dto.patientId.toUpperCase();
    if (visit.patientId !== patientId)
      throw new BadRequestException(
        `Visit ${visit.id} belongs to patient ${visit.patientId}, not ${patientId}.`,
      );
    if (!isActiveStatus(visit.status))
      throw new ConflictException(
        `Visit ${visit.id} is ${visit.status.toLowerCase().replace(/_/g, ' ')}; reopen it before referring.`,
      );
    const duplicate = await this.referralRepo.findOne({
      where: {
        visitId: visit.id,
        specialty: dto.specialty,
        status: In(['REQUESTED', 'ACCEPTED', 'IN_PROGRESS']),
      },
    });
    if (duplicate)
      throw new ConflictException(
        `A ${dto.specialty} referral (${duplicate.id}, ${duplicate.status}) is already open for this visit.`,
      );
    const patient = await this.patientRepo.findOne({
      where: { id: patientId },
    });
    const who = patient ? `${patient.name} (${patient.id})` : patientId;

    let assignedSpecialistName: string | undefined;
    if (dto.assignedSpecialistId) {
      const spec = await this.userRepo.findOne({
        where: { id: dto.assignedSpecialistId },
      });
      if (spec) {
        assignedSpecialistName = spec.displayName;
      }
    }

    const reqUserId = requestedBy.userId || (requestedBy as any).id;
    const referral = this.referralRepo.create({
      id: newId('CR', 6),
      visitId: dto.visitId,
      patientId,
      requestedById: reqUserId,
      requestedByName:
        (requestedBy as any).displayName || requestedBy.userName || 'Unknown',
      specialty: dto.specialty,
      assignedSpecialistId: dto.assignedSpecialistId || null,
      assignedSpecialistName: assignedSpecialistName || null,
      urgency: dto.urgency || 'ROUTINE',
      reason: dto.reason,
      aiRationale: dto.aiRationale || null,
      evidence: dto.evidence || null,
      status: 'REQUESTED',
    });

    const saved = await this.referralRepo.save(referral);

    // Rule 1: Notify target specialist(s)
    if (dto.assignedSpecialistId) {
      await this.notificationService.sendNotification({
        recipientUserId: dto.assignedSpecialistId,
        type: 'REFERRAL_CREATED',
        title: `New Referral (${saved.urgency})`,
        body: `New ${saved.urgency.toLowerCase()} ${saved.specialty} referral for patient ${who}. Reason: ${saved.reason}`,
        payload: {
          referralId: saved.id,
          visitId: saved.visitId,
          patientId: saved.patientId,
        },
      });
    } else {
      // Find specialists matching specialty
      const specialists = await this.userRepo.find({
        where: { role: 'SPECIALIST' as any, specialty: dto.specialty },
      });
      for (const spec of specialists) {
        await this.notificationService.sendNotification({
          recipientUserId: spec.id,
          type: 'REFERRAL_CREATED',
          title: `New Referral Request (${saved.urgency})`,
          body: `New ${saved.urgency.toLowerCase()} ${saved.specialty} referral request for patient ${who}. Reason: ${saved.reason}`,
          payload: {
            referralId: saved.id,
            visitId: saved.visitId,
            patientId: saved.patientId,
          },
        });
      }
    }

    // Rule 2: Notify primary doctor on visit if different from requester
    if (visit.primaryDoctorId && visit.primaryDoctorId !== reqUserId) {
      await this.notificationService.sendNotification({
        recipientUserId: visit.primaryDoctorId,
        type: 'REFERRAL_CREATED',
        title: 'Referral Placed for Your Patient',
        body: `A ${saved.specialty} referral was requested for patient ${who}.`,
        payload: {
          referralId: saved.id,
          visitId: saved.visitId,
          patientId: saved.patientId,
        },
      });
    }

    // Rule 3: Patient notice stub
    await this.notificationService.createPatientNotice({
      patientId: saved.patientId,
      visitId: saved.visitId,
      message: `A specialist referral request to ${saved.specialty} has been placed for your visit.`,
      channel: 'STUB',
    });

    // Rule 4: Socket event
    this.eventsGateway.emitReferralCreated({
      id: saved.id,
      visitId: saved.visitId,
      patientId: saved.patientId,
      specialty: saved.specialty,
      urgency: saved.urgency,
      status: saved.status,
    });

    return saved;
  }

  async transitionStatus(
    referralId: string,
    toStatus: ReferralStatus,
    actor: AuthUser,
    cancellationReason?: string,
  ): Promise<ConsultationRequestEntity> {
    const referral = await this.referralRepo.findOne({
      where: { id: referralId },
    });
    if (!referral) {
      throw new NotFoundException(`Referral ${referralId} not found`);
    }

    const validTargets = ALLOWED_TRANSITIONS[referral.status] || [];
    if (!validTargets.includes(toStatus)) {
      throw new BadRequestException(
        `Cannot transition referral from ${referral.status} to ${toStatus}. Allowed: ${validTargets.join(', ') || 'none'}`,
      );
    }

    referral.status = toStatus;
    const now = new Date();
    const actorUserId = actor.userId || (actor as any).id;

    if (toStatus === 'ACCEPTED') {
      referral.acceptedAt = now;
      if (!referral.assignedSpecialistId && actor.role === 'SPECIALIST') {
        referral.assignedSpecialistId = actorUserId;
        referral.assignedSpecialistName =
          (actor as any).displayName || actor.userName || 'Unknown';
      }
    } else if (toStatus === 'COMPLETED') {
      referral.completedAt = now;
    } else if (toStatus === 'CANCELLED') {
      referral.cancelledAt = now;
      if (cancellationReason) {
        referral.cancellationReason = cancellationReason;
      }
    }

    const saved = await this.referralRepo.save(referral);

    // Rule on Completion: Notify primary requester & patient notice
    if (toStatus === 'COMPLETED') {
      const done = await this.patientRepo.findOne({
        where: { id: saved.patientId },
      });
      const whoDone = done ? `${done.name} (${done.id})` : saved.patientId;
      // The specialist's part is finished: hand the visit back to the doctor for follow-up.
      const visit = await this.visitRepo.findOne({
        where: { id: saved.visitId },
      });
      if (visit?.status === 'IN_CONSULTATION')
        await this.visits.transition(visit, 'FOLLOW_UP', actor, {
          note: `${saved.specialty} consultation completed`,
          system: true,
        });
      await this.notificationService.sendNotification({
        recipientUserId: saved.requestedById,
        type: 'REFERRAL_COMPLETED',
        title: 'Referral Completed',
        body: `The ${saved.specialty} consultation for patient ${whoDone} has been completed. Visit moved to follow-up.`,
        payload: {
          referralId: saved.id,
          visitId: saved.visitId,
          patientId: saved.patientId,
        },
      });

      await this.notificationService.createPatientNotice({
        patientId: saved.patientId,
        visitId: saved.visitId,
        message: `Your ${saved.specialty} specialist consultation has been completed.`,
        channel: 'STUB',
      });
    }

    this.eventsGateway.emitReferralUpdated({
      id: saved.id,
      visitId: saved.visitId,
      patientId: saved.patientId,
      specialty: saved.specialty,
      status: saved.status,
    });

    return saved;
  }

  async getReferral(id: string): Promise<ConsultationRequestEntity> {
    const ref = await this.referralRepo.findOne({ where: { id } });
    if (!ref) {
      throw new NotFoundException(`Referral ${id} not found`);
    }
    return ref;
  }

  async listReferrals(filters: {
    patientId?: string;
    visitId?: string;
    assignedSpecialistId?: string;
    specialty?: string;
    status?: ReferralStatus;
  }): Promise<ConsultationRequestEntity[]> {
    const qb = this.referralRepo.createQueryBuilder('r');

    if (filters.patientId) {
      qb.andWhere('r.patientId = :patientId', { patientId: filters.patientId });
    }
    if (filters.visitId) {
      qb.andWhere('r.visitId = :visitId', { visitId: filters.visitId });
    }
    if (filters.assignedSpecialistId) {
      qb.andWhere('r.assignedSpecialistId = :assignedSpecialistId', {
        assignedSpecialistId: filters.assignedSpecialistId,
      });
    }
    if (filters.specialty) {
      qb.andWhere('r.specialty = :specialty', { specialty: filters.specialty });
    }
    if (filters.status) {
      qb.andWhere('r.status = :status', { status: filters.status });
    }

    qb.orderBy('r.createdAt', 'DESC');
    return qb.getMany();
  }

  /** Adds the patient's name/age/gender to each referral so no screen has to look patients up (a specialist cannot list patients). */
  async withPatientInfo<T extends { patientId: string }>(
    items: T[],
  ): Promise<
    Array<
      T & {
        patientName: string | null;
        patientAge: number | null;
        patientGender: string | null;
      }
    >
  > {
    const ids = [...new Set(items.map((i) => i.patientId))];
    const patients = ids.length
      ? await this.patientRepo.find({ where: { id: In(ids) } })
      : [];
    const byId = new Map(patients.map((p) => [p.id, p]));
    return items.map((i) => ({
      ...i,
      patientName: byId.get(i.patientId)?.name ?? null,
      patientAge: byId.get(i.patientId)?.age ?? null,
      patientGender: byId.get(i.patientId)?.gender ?? null,
    }));
  }

  /** Referrals a specialist may work on: assigned to them, or unassigned and in their specialty. */
  async listForSpecialist(
    userId: string,
  ): Promise<ConsultationRequestEntity[]> {
    const me = await this.userRepo.findOne({ where: { id: userId } });
    const qb = this.referralRepo.createQueryBuilder('r');
    if (me?.specialty)
      qb.where(
        '(r."assignedSpecialistId" = :id OR (r.specialty = :sp AND r."assignedSpecialistId" IS NULL))',
        { id: userId, sp: me.specialty },
      );
    else qb.where('r."assignedSpecialistId" = :id', { id: userId });
    const rank: Record<string, number> = {
      EMERGENCY: 0,
      URGENT: 1,
      ROUTINE: 2,
    };
    return (await qb.getMany()).sort(
      (a, b) =>
        (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /** A specialist may see a referral only if it is theirs (see `listForSpecialist`). */
  async assertSpecialistOwns(userId: string, referralId: string) {
    const mine = await this.listForSpecialist(userId);
    const hit = mine.find((r) => r.id === referralId);
    if (!hit)
      throw new ForbiddenException('This referral is not assigned to you.');
    return hit;
  }

  /** A specialist may see a patient only through a referral that is theirs and not cancelled. */
  async specialistCanSeePatient(
    userId: string,
    patientId: string,
  ): Promise<boolean> {
    return (await this.listForSpecialist(userId)).some(
      (r) =>
        r.patientId === patientId.toUpperCase() && r.status !== 'CANCELLED',
    );
  }
}
