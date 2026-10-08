import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConsultationRequestEntity,
  ReferralStatus,
  ReferralUrgency,
} from '../../database/entities/consultation-request.entity';
import { VisitEntity } from '../../database/entities/visit.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { NotificationService } from '../notifications/notification.service';
import { HospitalEventsGateway } from '../../events/hospital-events.gateway';
import { AuthUser } from '../../security/auth-user';
import { newId } from '../../common/ids';

export class CreateReferralDto {
  visitId!: string;
  patientId!: string;
  specialty!: string;
  assignedSpecialistId?: string;
  urgency?: ReferralUrgency;
  reason!: string;
  aiRationale?: string;
  evidence?: any;
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
      patientId: dto.patientId,
      requestedById: reqUserId,
      requestedByName: (requestedBy as any).displayName || requestedBy.userName || 'Unknown',
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
        body: `You have been assigned a referral for Patient ${saved.patientId} (${saved.specialty}). Reason: ${saved.reason}`,
        payload: { referralId: saved.id, visitId: saved.visitId, patientId: saved.patientId },
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
          body: `A new ${saved.specialty} referral has been requested for Patient ${saved.patientId}. Reason: ${saved.reason}`,
          payload: { referralId: saved.id, visitId: saved.visitId, patientId: saved.patientId },
        });
      }
    }

    // Rule 2: Notify primary doctor on visit if different from requester
    if (visit.primaryDoctorId && visit.primaryDoctorId !== reqUserId) {
      await this.notificationService.sendNotification({
        recipientUserId: visit.primaryDoctorId,
        type: 'REFERRAL_CREATED',
        title: 'Referral Placed for Your Patient',
        body: `A ${saved.specialty} referral was requested for Patient ${saved.patientId}.`,
        payload: { referralId: saved.id, visitId: saved.visitId, patientId: saved.patientId },
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
    const referral = await this.referralRepo.findOne({ where: { id: referralId } });
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
        referral.assignedSpecialistName = (actor as any).displayName || actor.userName || 'Unknown';
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
      await this.notificationService.sendNotification({
        recipientUserId: saved.requestedById,
        type: 'REFERRAL_COMPLETED',
        title: 'Referral Completed',
        body: `The ${saved.specialty} consultation for Patient ${saved.patientId} has been completed.`,
        payload: { referralId: saved.id, visitId: saved.visitId, patientId: saved.patientId },
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
}
