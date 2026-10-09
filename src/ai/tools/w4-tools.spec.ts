import { buildClinicalReadTools } from './clinical/clinical-read.tools';
import { buildProposeTools } from './actions/propose.tools';

describe('W4 Tools Suite', () => {
  describe('Clinical Read Tools', () => {
    let mockHospital: any;
    let mockRecords: any;
    let mockVisits: any;
    let mockMedSafety: any;
    let mockRag: any;
    let readTools: ReturnType<typeof buildClinicalReadTools>;

    beforeEach(() => {
      mockHospital = {
        getPatientById: jest.fn().mockResolvedValue({
          id: 'P1001',
          name: 'John Doe',
          age: 45,
          gender: 'male',
          allergies: ['Penicillin'],
          conditions: ['Hypertension'],
          currentMedications: ['Lisinopril 10mg'],
        }),
        getPatientLabs: jest.fn().mockResolvedValue([
          {
            testName: 'Serum Creatinine',
            value: '1.1',
            unit: 'mg/dL',
            referenceRange: '0.7-1.3',
            status: 'FINAL',
            date: '2026-10-08',
          },
        ]),
      };
      mockRecords = {
        listVitals: jest.fn().mockResolvedValue([
          {
            recordedAt: '2026-10-08T10:00:00Z',
            heartRate: 80,
            bpSystolic: 120,
            spO2: 98,
            tempCelsius: 37.0,
            respiratoryRate: 16,
            consciousness: 'ALERT',
            news2Score: 0,
            riskLevel: 'LOW',
          },
        ]),
      };
      mockVisits = {
        listForPatient: jest.fn().mockResolvedValue([
          {
            id: 'V100',
            patientId: 'P1001',
            status: 'IN_CONSULTATION',
            statusLabel: 'In Consultation',
            chiefComplaint: 'Chest tightness',
            priority: 2,
            arrivedAt: '2026-10-08T09:00:00Z',
            triagedAt: '2026-10-08T09:15:00Z',
            primaryDoctorId: 'DOC1',
            department: 'Emergency',
            closedAt: null,
            outcome: null,
          },
        ]),
      };
      mockMedSafety = {
        creatinineToMgDl: jest.fn().mockReturnValue(1.1),
        audit: jest.fn().mockReturnValue({ findings: [] }),
      };
      mockRag = {
        searchPolicies: jest.fn().mockResolvedValue([
          {
            source: 'cardiology-guidelines.md',
            heading: 'Chest Pain Protocol',
            content:
              'Troponin and 12-lead ECG are required for acute chest pain.',
            score: 0.92,
          },
        ]),
      };

      readTools = buildClinicalReadTools({
        hospital: mockHospital,
        records: mockRecords,
        visits: mockVisits,
        medSafety: mockMedSafety,
        rag: mockRag,
      });
    });

    it('getCurrentVisit returns current open visit summary', async () => {
      const tool = readTools.find((t) => t.name === 'getCurrentVisit')!;
      expect(tool).toBeDefined();
      const res: any = await tool.run(
        { patientId: 'P1001' },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.currentVisit.id).toBe('V100');
      expect(res.currentVisit.status).toBe('IN_CONSULTATION');
    });

    it('getVitalsHistory returns list of vitals', async () => {
      const tool = readTools.find((t) => t.name === 'getVitalsHistory')!;
      const res: any = await tool.run(
        { patientId: 'P1001', limit: 5 },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.vitals.length).toBe(1);
      expect(res.vitals[0].heartRate).toBe(80);
    });

    it('getLabs returns patient lab test results', async () => {
      const tool = readTools.find((t) => t.name === 'getLabs')!;
      const res: any = await tool.run(
        { patientId: 'P1001', limit: 10 },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.labs[0].testName).toBe('Serum Creatinine');
    });

    it('getMedications returns medications and allergies', async () => {
      const tool = readTools.find((t) => t.name === 'getMedications')!;
      const res: any = await tool.run(
        { patientId: 'P1001' },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.currentMedications).toEqual(['Lisinopril 10mg']);
      expect(res.allergies).toEqual(['Penicillin']);
    });

    it('getAllergies returns allergies and conditions', async () => {
      const tool = readTools.find((t) => t.name === 'getAllergies')!;
      const res: any = await tool.run(
        { patientId: 'P1001' },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.allergies).toEqual(['Penicillin']);
      expect(res.conditions).toEqual(['Hypertension']);
    });

    it('searchClinicalGuidelines searches vector RAG and returns citations', async () => {
      const tool = readTools.find(
        (t) => t.name === 'searchClinicalGuidelines',
      )!;
      const res: any = await tool.run(
        { query: 'chest pain', topK: 3 },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.guidelines[0].heading).toBe('Chest Pain Protocol');
      const citations = tool.citations?.(res);
      expect(citations).toEqual([
        { file: 'cardiology-guidelines.md', heading: 'Chest Pain Protocol' },
      ]);
    });
  });

  describe('Propose Tools (No-Write Gate)', () => {
    let proposeTools: ReturnType<typeof buildProposeTools>;

    beforeEach(() => {
      proposeTools = buildProposeTools();
    });

    it('proposeReferral returns proposal object only and does NOT write to DB', async () => {
      const tool = proposeTools.find((t) => t.name === 'proposeReferral')!;
      expect(tool).toBeDefined();
      const res: any = await tool.run(
        {
          patientId: 'P1001',
          specialty: 'Cardiology',
          urgency: 'URGENT',
          reason: 'Acute substernal chest pain with elevated troponin',
          evidence: [{ field: 'NEWS2', value: '5', source: 'Triage' }],
        },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.proposalType).toBe('REFERRAL');
      expect(res.status).toBe('PROPOSED');
      expect(res.requiresApproval).toBe(true);
      expect(res.proposedAction.specialty).toBe('Cardiology');
    });

    it('proposeFollowUp returns proposal object', async () => {
      const tool = proposeTools.find((t) => t.name === 'proposeFollowUp')!;
      const followUp: any = {
        generateProposal: jest.fn().mockResolvedValue({
          plan: {
            id: 'PLAN1',
            patientId: 'P1001',
            items: [{ summary: 'Cardiology review' }],
          },
          proposalAction: {
            id: 'ACT9',
            summary: 'Follow-up plan',
            tier: 'ASK',
            expiresAt: new Date(),
          },
        }),
      };
      const visits: any = {
        getActive: jest.fn().mockResolvedValue({ id: 'V100' }),
      };
      const t = buildProposeTools({ followUp, visits }).find(
        (x) => x.name === 'proposeFollowUp',
      )!;
      const res: any = await t.run(
        { patientId: 'P1001' },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.proposalType).toBe('FOLLOW_UP');
      expect(res.status).toBe('PENDING_APPROVAL');
      expect(res.proposedAction.planId).toBe('PLAN1');
      expect(tool).toBeDefined();
    });

    it('proposeTask returns proposal object', async () => {
      const tool = proposeTools.find((t) => t.name === 'proposeTask')!;
      const res: any = await tool.run(
        {
          title: 'Check vitals in 1 hour',
          assignedToRole: 'NURSE',
          patientId: 'P1001',
          priority: 'HIGH',
        },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.proposalType).toBe('STAFF_TASK');
      expect(res.status).toBe('PROPOSED');
    });

    it('proposeNotification returns proposal object', async () => {
      const tool = proposeTools.find((t) => t.name === 'proposeNotification')!;
      const res: any = await tool.run(
        {
          recipientType: 'ROLE',
          recipientTarget: 'CARDIOLOGY_SPECIALIST',
          notificationType: 'REFERRAL_NOTICE',
          message: 'Urgent cardiology referral proposed for P1001',
          patientId: 'P1001',
        },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.proposalType).toBe('NOTIFICATION');
      expect(res.status).toBe('PROPOSED');
    });

    it('proposeLabOrder returns proposal object', async () => {
      const tool = proposeTools.find((t) => t.name === 'proposeLabOrder')!;
      const res: any = await tool.run(
        {
          patientId: 'P1001',
          testName: 'Troponin I STAT',
          urgency: 'STAT',
          clinicalIndication: 'Rule out acute myocardial infarction',
        },
        { user: { role: 'DOCTOR' } as any },
      );
      expect(res.success).toBe(true);
      expect(res.proposalType).toBe('LAB_ORDER');
      expect(res.status).toBe('PROPOSED');
    });
  });
});
