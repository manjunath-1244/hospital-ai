jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
}));

import { SpecialistPortalService } from './specialist-portal.service';
import { SpecialistSummaryService } from './specialist-summary.service';
import { ConsultationRequestEntity } from '../../database/entities/consultation-request.entity';
import { AuthUser } from '../../security/auth-user';

describe('W8 Specialist Portal & AI Referral Summary', () => {
  let portalService: SpecialistPortalService;
  let summaryService: SpecialistSummaryService;

  let mockReferralRepo: any;
  let mockAssessmentRepo: any;
  let mockReferralService: any;
  let mockHospital: any;
  let mockRecords: any;
  let mockKnowledge: any;

  const specialistUser: AuthUser = {
    userId: 'U-CARDIO-1',
    userName: 'cardiologist',
    role: 'SPECIALIST',
  };
  (specialistUser as any).specialty = 'Cardiology';
  (specialistUser as any).displayName = 'Dr. Sarah Wilson';

  beforeEach(() => {
    mockReferralRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    mockAssessmentRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((e) => Promise.resolve({ ...e })),
    };

    mockReferralService = {
      transitionStatus: jest.fn((id, status) =>
        Promise.resolve({ id, status }),
      ),
    };

    mockHospital = {
      getPatientById: jest.fn().mockResolvedValue({
        id: 'P1001',
        name: 'Eleanor Vance',
        age: 62,
        gender: 'female',
        currentMedications: ['Aspirin 81mg', 'Atorvastatin 40mg'],
        conditions: ['Hypertension'],
      }),
      getPatientLabs: jest.fn().mockResolvedValue([
        { testName: 'Troponin T', value: '0.8', unit: 'ng/mL', status: 'CRITICAL' },
        { testName: 'HbA1c', value: '7.2', unit: '%', status: 'ABNORMAL' },
      ]),
    };

    mockRecords = {
      listVitals: jest.fn().mockResolvedValue([
        {
          recordedAt: new Date(),
          heartRate: 110,
          bpSystolic: 165,
          spO2: 94,
          news2Score: 6,
          riskLevel: 'MEDIUM',
        },
      ]),
    };

    mockKnowledge = {
      listDocuments: jest.fn().mockResolvedValue([
        {
          id: 'doc-1',
          title: 'Cardiology SOP Guidelines',
          filename: 'cardiology-referral-guidelines.md',
        },
      ]),
    };

    summaryService = new SpecialistSummaryService(
      mockReferralRepo,
      mockHospital,
      mockRecords,
      mockKnowledge,
    );

    portalService = new SpecialistPortalService(
      mockReferralRepo,
      mockAssessmentRepo,
      mockReferralService,
      summaryService,
    );
  });

  describe('Specialist Consultation Inbox', () => {
    it('sorts consultations by urgency (EMERGENCY > URGENT > ROUTINE)', async () => {
      const items: Partial<ConsultationRequestEntity>[] = [
        {
          id: 'CR-1',
          specialty: 'Cardiology',
          urgency: 'ROUTINE',
          createdAt: new Date('2026-10-08T10:00:00Z'),
        },
        {
          id: 'CR-2',
          specialty: 'Cardiology',
          urgency: 'EMERGENCY',
          createdAt: new Date('2026-10-08T11:00:00Z'),
        },
        {
          id: 'CR-3',
          specialty: 'Cardiology',
          urgency: 'URGENT',
          createdAt: new Date('2026-10-08T12:00:00Z'),
        },
      ];

      mockReferralRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(items),
      });

      const result = await portalService.getMyConsultations(specialistUser);

      expect(result.length).toBe(3);
      expect(result[0].id).toBe('CR-2'); // EMERGENCY
      expect(result[1].id).toBe('CR-3'); // URGENT
      expect(result[2].id).toBe('CR-1'); // ROUTINE
    });
  });

  describe('AI Referral Summary', () => {
    it('synthesizes patient findings, abnormal labs, and cited guidelines', async () => {
      mockReferralRepo.findOne.mockResolvedValue({
        id: 'CR-100',
        patientId: 'P1001',
        visitId: 'V1001001',
        specialty: 'Cardiology',
        urgency: 'URGENT',
        reason: 'Chest pain with troponin elevation',
        aiRationale: 'Cardiology guidelines criteria met',
        evidence: [{ field: 'troponin', value: '0.8 ng/mL' }],
      });

      const summary = await summaryService.generateSummary('CR-100');

      expect(summary.referralId).toBe('CR-100');
      expect(summary.specialty).toBe('Cardiology');
      expect(summary.keyClinicalFindings.abnormalLabs?.length).toBe(2);
      expect(summary.keyClinicalFindings.recentVitals.news2Score).toBe(6);
      expect(summary.guidelinesCited.length).toBe(1);
      expect(summary.guidelinesCited[0].filename).toBe('cardiology-referral-guidelines.md');
    });
  });

  describe('Complete Consultation Workflow', () => {
    it('creates specialist assessment and transitions referral to COMPLETED', async () => {
      mockReferralRepo.findOne.mockResolvedValue({
        id: 'CR-100',
        visitId: 'V1001001',
        patientId: 'P1001',
        specialty: 'Cardiology',
        status: 'ACCEPTED',
      });

      const res = await portalService.completeConsultation(
        'CR-100',
        {
          assessment: 'Acute coronary syndrome ruled out; stable angina.',
          recommendation: 'Continue dual antiplatelet therapy and statin.',
          treatment: 'Aspirin 81mg daily, Atorvastatin 80mg daily',
          followUp: 'Follow up in cardiology clinic in 4 weeks.',
        },
        specialistUser,
      );

      expect(res.assessment.id).toBeDefined();
      expect(res.assessment.assessment).toContain('Acute coronary syndrome');
      expect(mockAssessmentRepo.save).toHaveBeenCalled();
      expect(mockReferralService.transitionStatus).toHaveBeenCalledWith(
        'CR-100',
        'COMPLETED',
        specialistUser,
      );
    });
  });
});
