jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { NotificationService } from '../notifications/notification.service';
import { ConsultationRequestEntity } from '../../database/entities/consultation-request.entity';
import { ActionExecutorService } from '../../ai/actions/action-executor.service';
import { AuthUser } from '../../security/auth-user';

describe('W7 Referral Workflow & Notifications', () => {
  let referralService: ReferralService;
  let notificationService: NotificationService;
  let executorService: ActionExecutorService;

  let mockReferralRepo: any;
  let mockNotificationRepo: any;
  let mockNoticeRepo: any;
  let mockVisitRepo: any;
  let mockUserRepo: any;
  let mockActionRepo: any;
  let mockEventsGateway: any;
  let mockLifecycle: any;
  let mockHospital: any;
  let mockPatientRepo: any;
  let mockVisits: any;

  const doctorUser: AuthUser = {
    userId: 'U-DOCTOR-1',
    userName: 'doctor',
    role: 'DOCTOR',
  };

  const specialistUser: AuthUser = {
    userId: 'U-CARDIO-1',
    userName: 'cardiologist',
    role: 'SPECIALIST',
  };

  beforeEach(() => {
    mockReferralRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve({ ...entity })),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    mockNotificationRepo = {
      create: jest.fn((dto) => ({ ...dto, createdAt: new Date() })),
      save: jest.fn((entity) => Promise.resolve({ ...entity })),
      findOne: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
    };

    mockNoticeRepo = {
      create: jest.fn((dto) => ({ ...dto, createdAt: new Date() })),
      save: jest.fn((entity) => Promise.resolve({ ...entity })),
    };

    mockVisitRepo = {
      findOne: jest.fn(),
    };

    mockUserRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    mockActionRepo = {
      findOne: jest.fn(),
      save: jest.fn((e) => Promise.resolve(e)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockEventsGateway = {
      emitNotificationToUser: jest.fn(),
      emitReferralCreated: jest.fn(),
      emitReferralUpdated: jest.fn(),
      emitVisitUpdated: jest.fn(),
      emitActionExecuted: jest.fn(),
      emitActionDecided: jest.fn(),
    };

    mockLifecycle = {
      registerOutpatient: jest.fn(),
      createTask: jest.fn(),
    };

    mockHospital = {
      getPatientById: jest.fn().mockResolvedValue({ id: 'P1001' }),
    };

    notificationService = new NotificationService(
      mockNotificationRepo,
      mockNoticeRepo,
      mockEventsGateway,
    );

    mockPatientRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'P1001', name: 'Eleanor Vance' }),
    };
    mockVisits = {
      transition: jest.fn(async (v: any) => ({ ...v, status: 'FOLLOW_UP' })),
    };

    referralService = new ReferralService(
      mockReferralRepo,
      mockVisitRepo,
      mockUserRepo,
      mockPatientRepo,
      mockVisits,
      notificationService,
      mockEventsGateway,
    );

    executorService = new ActionExecutorService(
      mockActionRepo,
      mockLifecycle,
      mockHospital,
      {} as any,
      {} as any,
      mockEventsGateway,
      referralService,
      {} as any, // lab orders
      {} as any, // notifications
      {} as any, // specialists
      {} as any, // follow-up plans
    );
  });

  describe('Referral Creation & Notifications', () => {
    it('creates a referral and triggers notification rules', async () => {
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'V1001001',
        patientId: 'P1001',
        status: 'IN_CONSULTATION',
        primaryDoctorId: 'U-DOCTOR-1',
      });
      mockUserRepo.findOne.mockResolvedValue(specialistUser);

      const ref = await referralService.createReferral(
        {
          visitId: 'V1001001',
          patientId: 'P1001',
          specialty: 'Cardiology',
          assignedSpecialistId: 'U-CARDIO-1',
          urgency: 'URGENT',
          reason: 'Chest pain with elevated troponin',
          aiRationale: 'Cardiology guidelines criteria met',
        },
        doctorUser,
      );

      expect(ref.id).toBeDefined();
      expect(ref.specialty).toBe('Cardiology');
      expect(ref.status).toBe('REQUESTED');
      expect(ref.urgency).toBe('URGENT');
      expect(mockNotificationRepo.save).toHaveBeenCalled();
      expect(mockNoticeRepo.save).toHaveBeenCalled();
      expect(mockEventsGateway.emitReferralCreated).toHaveBeenCalled();
    });

    it('throws NotFoundException if visit is missing', async () => {
      mockVisitRepo.findOne.mockResolvedValue(null);

      await expect(
        referralService.createReferral(
          {
            visitId: 'V9999999',
            patientId: 'P1001',
            specialty: 'Cardiology',
            reason: 'Test',
          },
          doctorUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Referral Status Transitions', () => {
    const existingReferral: ConsultationRequestEntity = {
      id: 'CR123456',
      visitId: 'V1001001',
      patientId: 'P1001',
      requestedById: doctorUser.userId,
      requestedByName: doctorUser.userName,
      specialty: 'Cardiology',
      urgency: 'URGENT',
      reason: 'Chest pain',
      status: 'REQUESTED',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('transitions REQUESTED -> ACCEPTED', async () => {
      mockReferralRepo.findOne.mockResolvedValue({ ...existingReferral });

      const updated = await referralService.transitionStatus(
        'CR123456',
        'ACCEPTED',
        specialistUser,
      );

      expect(updated.status).toBe('ACCEPTED');
      expect(updated.acceptedAt).toBeDefined();
      expect(updated.assignedSpecialistId).toBe(specialistUser.userId);
      expect(mockEventsGateway.emitReferralUpdated).toHaveBeenCalled();
    });

    it('transitions ACCEPTED -> IN_PROGRESS -> COMPLETED', async () => {
      mockReferralRepo.findOne.mockResolvedValue({
        ...existingReferral,
        status: 'ACCEPTED',
      });

      const inProgress = await referralService.transitionStatus(
        'CR123456',
        'IN_PROGRESS',
        specialistUser,
      );
      expect(inProgress.status).toBe('IN_PROGRESS');

      mockReferralRepo.findOne.mockResolvedValue({
        ...existingReferral,
        status: 'IN_PROGRESS',
      });

      const completed = await referralService.transitionStatus(
        'CR123456',
        'COMPLETED',
        specialistUser,
      );
      expect(completed.status).toBe('COMPLETED');
      expect(completed.completedAt).toBeDefined();
      expect(mockNotificationRepo.save).toHaveBeenCalled();
      expect(mockNoticeRepo.save).toHaveBeenCalled();
    });

    it('rejects invalid state transition (REQUESTED -> COMPLETED)', async () => {
      mockReferralRepo.findOne.mockResolvedValue({ ...existingReferral });

      await expect(
        referralService.transitionStatus(
          'CR123456',
          'COMPLETED',
          specialistUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows CANCELLED from REQUESTED with a reason', async () => {
      mockReferralRepo.findOne.mockResolvedValue({ ...existingReferral });

      const cancelled = await referralService.transitionStatus(
        'CR123456',
        'CANCELLED',
        doctorUser,
        'Patient discharged',
      );

      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancellationReason).toBe('Patient discharged');
      expect(cancelled.cancelledAt).toBeDefined();
    });
  });

  describe('Notification Persistence & Read Tracking', () => {
    it('persists notification and emits socket event to user room', async () => {
      const notif = await notificationService.sendNotification({
        recipientUserId: 'U-CARDIO-1',
        type: 'REFERRAL_CREATED',
        title: 'New Referral',
        body: 'You have a referral',
      });

      expect(notif.id).toBeDefined();
      expect(mockNotificationRepo.save).toHaveBeenCalled();
      expect(mockEventsGateway.emitNotificationToUser).toHaveBeenCalledWith(
        'U-CARDIO-1',
        expect.objectContaining({ title: 'New Referral' }),
      );
    });

    it('marks notification as read', async () => {
      mockNotificationRepo.findOne.mockResolvedValue({
        id: 'N1001001',
        recipientUserId: 'U-CARDIO-1',
        readAt: null,
      });

      const readNotif = await notificationService.markAsRead(
        'N1001001',
        'U-CARDIO-1',
      );
      expect(readNotif.readAt).toBeDefined();
    });

    it('creates patient notice stub and logs output', async () => {
      const notice = await notificationService.createPatientNotice({
        patientId: 'P1001',
        visitId: 'V1001001',
        message: 'Your appointment is booked',
      });

      expect(notice.id).toBeDefined();
      expect(notice.status).toBe('DELIVERED');
      expect(mockNoticeRepo.save).toHaveBeenCalled();
    });
  });

  describe('Action Approval Execution Integration (W6 + W7)', () => {
    it('approves a REFERRAL action and creates a consultation_request entity', async () => {
      const action: any = {
        id: 'ACT-REF-001',
        type: 'REFERRAL',
        tier: 'ASK',
        status: 'PENDING',
        proposedByUserId: 'U-DOCTOR-1',
        patientId: 'P1001',
        visitId: 'V1001001',
        summary: 'Referral to Cardiology',
        payload: {
          visitId: 'V1001001',
          patientId: 'P1001',
          specialty: 'Cardiology',
          assignedSpecialistId: 'U-CARDIO-1',
          urgency: 'URGENT',
          reason: 'Troponin elevation',
        },
        idempotencyKey: 'IDEM-REF-1',
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // A real store: the executor's read-back must find what it just created.
      let stored: any = null;
      mockReferralRepo.save = jest.fn((e: any) => {
        stored = { ...e };
        return Promise.resolve(stored);
      });
      mockReferralRepo.findOne = jest.fn(({ where }: any) =>
        Promise.resolve(where.visitId ? null : stored),
      );
      mockActionRepo.findOne.mockResolvedValue({ ...action });
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'V1001001',
        patientId: 'P1001',
        status: 'IN_CONSULTATION',
      });
      mockUserRepo.findOne.mockResolvedValue(specialistUser);

      const executedAction = await executorService.approveAndExecute(
        'ACT-REF-001',
        doctorUser,
      );

      expect(executedAction.status).toBe('DONE');
      expect(executedAction.result).toBeDefined();
      expect(executedAction.result?.specialty).toBe('Cardiology');
      expect(executedAction.verification?.verified).toBe(true);
      expect(mockEventsGateway.emitActionExecuted).toHaveBeenCalled();
    });
  });
});
