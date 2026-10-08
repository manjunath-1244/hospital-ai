import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import {
  NotificationChannel,
  NotificationEntity,
} from '../../database/entities/notification.entity';
import {
  PatientNoticeChannel,
  PatientNoticeEntity,
} from '../../database/entities/patient-notice.entity';
import { HospitalEventsGateway } from '../../events/hospital-events.gateway';
import { newId } from '../../common/ids';

export interface CreateNotificationDto {
  recipientUserId?: string | null;
  recipientPatientId?: string | null;
  type: string;
  title: string;
  body: string;
  payload?: any;
  channel?: NotificationChannel;
  sourceActionId?: string | null;
}

export interface CreatePatientNoticeDto {
  patientId: string;
  visitId?: string | null;
  message: string;
  channel?: PatientNoticeChannel;
  recipientContact?: string | null;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notifRepo: Repository<NotificationEntity>,
    @InjectRepository(PatientNoticeEntity)
    private readonly noticeRepo: Repository<PatientNoticeEntity>,
    private readonly eventsGateway: HospitalEventsGateway,
  ) {}

  async sendNotification(
    dto: CreateNotificationDto,
  ): Promise<NotificationEntity> {
    const notif = this.notifRepo.create({
      id: newId('N', 8),
      recipientUserId: dto.recipientUserId || null,
      recipientPatientId: dto.recipientPatientId || null,
      type: dto.type,
      title: dto.title,
      body: dto.body,
      payload: dto.payload || null,
      channel: dto.channel || 'IN_APP',
      sourceActionId: dto.sourceActionId || null,
      deliveredAt: new Date(),
    });

    const saved = await this.notifRepo.save(notif);

    if (saved.recipientUserId) {
      this.eventsGateway.emitNotificationToUser(saved.recipientUserId, {
        id: saved.id,
        type: saved.type,
        title: saved.title,
        body: saved.body,
        createdAt: saved.createdAt,
        payload: saved.payload,
      });
    }

    return saved;
  }

  async createPatientNotice(
    dto: CreatePatientNoticeDto,
  ): Promise<PatientNoticeEntity> {
    const notice = this.noticeRepo.create({
      id: newId('PN', 8),
      patientId: dto.patientId,
      visitId: dto.visitId || null,
      channel: dto.channel || 'STUB',
      recipientContact: dto.recipientContact || null,
      message: dto.message,
      status: 'DELIVERED',
    });

    const saved = await this.noticeRepo.save(notice);

    // Honest log output for stub channel adapter
    this.logger.log(
      `[PATIENT_NOTICE_ADAPTER] Delivered notice (${saved.channel}) to Patient ${saved.patientId}: "${saved.message}"`,
    );

    // Also persist in notifications for patient audit
    await this.sendNotification({
      recipientPatientId: dto.patientId,
      type: 'PATIENT_NOTICE',
      title: 'Patient Communication',
      body: dto.message,
      channel: 'PATIENT_NOTICE',
      payload: { noticeId: saved.id, visitId: dto.visitId },
    });

    return saved;
  }

  async getUserNotifications(
    userId: string,
    unreadOnly = false,
  ): Promise<NotificationEntity[]> {
    const qb = this.notifRepo.createQueryBuilder('n');
    qb.where('n.recipientUserId = :userId', { userId });
    if (unreadOnly) {
      qb.andWhere('n.readAt IS NULL');
    }
    qb.orderBy('n.createdAt', 'DESC');
    qb.take(100);
    return qb.getMany();
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notifRepo.count({
      where: {
        recipientUserId: userId,
        readAt: IsNull(),
      },
    });
  }

  async markAsRead(id: string, userId: string): Promise<NotificationEntity> {
    const notif = await this.notifRepo.findOne({ where: { id } });
    if (!notif) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    if (notif.recipientUserId && notif.recipientUserId !== userId) {
      // Allow marking read if assigned
      throw new NotFoundException(`Notification ${id} not found for user`);
    }
    notif.readAt = new Date();
    return this.notifRepo.save(notif);
  }

  async markAllAsRead(userId: string): Promise<{ count: number }> {
    const result = await this.notifRepo
      .createQueryBuilder()
      .update(NotificationEntity)
      .set({ readAt: new Date() })
      .where('recipientUserId = :userId AND readAt IS NULL', { userId })
      .execute();

    return { count: result.affected || 0 };
  }
}
