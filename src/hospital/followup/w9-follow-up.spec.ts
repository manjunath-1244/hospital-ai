jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
}));

import { FollowUpService } from './follow-up.service';
import { LabOrdersService } from '../labs/lab-orders.service';
import { AuthUser } from '../../security/auth-user';

describe('W9 Follow-Up Agent & Lab Orders', () => {
  let followUpService: FollowUpService;
  let labOrdersService: LabOrdersService;

  let mockPlanRepo: any;
  let mockVisitRepo: any;
  let mockConsultRepo: any;
  let mockAssessmentRepo: any;
  let mockProposalService: any;
  let mockOrdersRepo: any;

  const doctorUser: AuthUser = {
    userId: 'U-DOCTOR-1',
    userName: 'doctor',
    role: 'DOCTOR',
  };

  beforeEach(() => {
    mockPlanRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((e) => Promise.resolve({ ...e })),
      findOne: jest.fn(),
    };

    mockVisitRepo = {
      findOne: jest.fn(),
    };

    mockConsultRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    mockAssessmentRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'SA-100',
          visitId: 'V1001001',
          specialty: 'Cardiology',
          requestId: 'CR-100',
        },
      ]),
    };

    mockProposalService = {
      propose: jest.fn((dto) =>
        Promise.resolve({
          id: 'ACT-FUP-1',
          type: 'FOLLOW_UP',
          tier: 'ASK',
          status: 'PENDING',
        }),
      ),
    };

    mockOrdersRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((e) => Promise.resolve({ ...e })),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    followUpService = new FollowUpService(
      mockPlanRepo,
      mockVisitRepo,
      mockConsultRepo,
      mockAssessmentRepo,
      mockProposalService,
    );

    labOrdersService = new LabOrdersService(mockOrdersRepo);
  });

  describe('Follow-Up Plan Proposal Generation', () => {
    it('generates a follow-up plan proposal with structured items and submits W6 proposal action', async () => {
      mockVisitRepo.findOne.mockResolvedValue({
        id: 'V1001001',
        patientId: 'P1001',
      });

      const res = await followUpService.generateProposal('V1001001', doctorUser);

      expect(res.plan.id).toBeDefined();
      expect(res.plan.items.length).toBe(4);
      expect(res.plan.items[0].type).toBe('APPOINTMENT');
      expect(res.plan.items[1].type).toBe('LAB_ORDER');
      expect(res.plan.items[2].type).toBe('TASK');
      expect(res.plan.items[3].type).toBe('PATIENT_NOTICE');

      expect(mockProposalService.propose).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'FOLLOW_UP',
          patientId: 'P1001',
          visitId: 'V1001001',
        }),
        doctorUser,
      );
    });
  });

  describe('Lab Orders & Result Linkage', () => {
    it('creates a lab order in ORDERED status', async () => {
      const order = await labOrdersService.createLabOrder(
        {
          visitId: 'V1001001',
          patientId: 'P1001',
          testName: 'Troponin T',
        },
        doctorUser,
      );

      expect(order.id).toBeDefined();
      expect(order.testName).toBe('Troponin T');
      expect(order.status).toBe('ORDERED');
      expect(mockOrdersRepo.save).toHaveBeenCalled();
    });

    it('links lab result to matching open order and updates status to RESULTED', async () => {
      const openOrder = {
        id: 'LO-1001',
        visitId: 'V1001001',
        patientId: 'P1001',
        testName: 'Troponin T',
        status: 'ORDERED',
      };

      mockOrdersRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([openOrder]),
      });

      const updated = await labOrdersService.linkResultToOrder(
        'P1001',
        'Troponin T',
        'LAB-999',
      );

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('RESULTED');
      expect(updated?.resultId).toBe('LAB-999');
    });
  });
});
