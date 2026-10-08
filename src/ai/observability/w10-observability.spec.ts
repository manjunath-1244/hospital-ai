jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
}));

import { RunRecorder } from './run-recorder';
import { AgentRunsService } from './agent-runs.service';
import { AuthUser } from '../../security/auth-user';
import { AgentRunEntity } from '../../database/entities/agent-run.entity';
import { AgentActionEntity } from '../../database/entities/agent-action.entity';

describe('W10 Agent Observability & Metrics', () => {
  const doctorUser: AuthUser = {
    userId: 'U-DOC-1',
    userName: 'doctor',
    role: 'DOCTOR',
  };

  describe('RunRecorder', () => {
    it('captures goal, decisions, and action proposal IDs on the trace', () => {
      const rec = new RunRecorder('chat', doctorUser, 'test-model');
      rec.setGoal('Check cardiology referral needs for patient P1001');
      rec.addDecision({
        what: 'Recommend Cardiology Specialist Referral',
        why: 'Elevated Troponin T and NEWS2 score of 6',
        evidence: [{ field: 'troponin', value: '0.8 ng/mL' }],
      });
      rec.addActionId('ACT-1001');

      const built = rec.build({
        status: 'OK',
        threadId: 'TH-123',
      });

      expect(built.goal).toBe(
        'Check cardiology referral needs for patient P1001',
      );
      expect(built.decisions.length).toBe(1);
      expect(built.decisions[0].what).toBe(
        'Recommend Cardiology Specialist Referral',
      );
      expect(built.actionIds).toEqual(['ACT-1001']);
    });
  });

  describe('AgentRunsService', () => {
    let runsService: AgentRunsService;
    let mockRunRepo: any;
    let mockActionRepo: any;

    beforeEach(() => {
      mockRunRepo = {
        save: jest.fn((run) => Promise.resolve(run)),
        create: jest.fn((run) => run),
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
      };

      mockActionRepo = {
        find: jest.fn().mockResolvedValue([]),
      };

      runsService = new AgentRunsService(mockRunRepo, mockActionRepo);
    });

    it('returns full agent run flow (Goal -> Context -> Steps -> Decisions -> Actions -> Result)', async () => {
      const sampleRun: Partial<AgentRunEntity> = {
        id: 'TRACE-001',
        kind: 'chat',
        userId: 'U-DOC-1',
        userRole: 'DOCTOR',
        model: 'llama3.2-hospital',
        status: 'OK',
        durationMs: 120,
        goal: 'Review chest pain patient P1001',
        contextHash: 'hash-123',
        context: { patientId: 'P1001', role: 'DOCTOR' },
        steps: [
          {
            type: 'memory',
            name: 'load-thread',
            startOffsetMs: 0,
            durationMs: 10,
            success: true,
          },
          {
            type: 'tool',
            name: 'getPatientSummary',
            startOffsetMs: 10,
            durationMs: 50,
            success: true,
          },
        ],
        toolCallCount: 1,
        decisions: [
          {
            what: 'Propose Cardiology Referral',
            why: 'NEWS2 = 6, Troponin = 0.8',
          },
        ],
        actionIds: ['ACT-001'],
      };

      const sampleActions: Partial<AgentActionEntity>[] = [
        {
          id: 'ACT-001',
          traceId: 'TRACE-001',
          type: 'REFERRAL',
          tier: 'ASK',
          status: 'APPROVED',
          summary: 'Specialist referral to Cardiology for P1001',
          payload: { specialty: 'Cardiology', patientId: 'P1001' },
          createdAt: new Date('2026-10-08T10:00:00Z'),
          decidedAt: new Date('2026-10-08T10:05:00Z'),
        },
      ];

      mockRunRepo.findOne.mockResolvedValue(sampleRun);
      mockActionRepo.find.mockResolvedValue(sampleActions);

      const runDetails = await runsService.get('TRACE-001');

      expect(runDetails.id).toBe('TRACE-001');
      expect(runDetails.goal).toBe('Review chest pain patient P1001');
      expect(runDetails.decisions.length).toBe(1);
      expect(runDetails.actions.length).toBe(1);
      expect(runDetails.actions[0].id).toBe('ACT-001');
      expect(runDetails.flow.result).toBe('SUCCESS');
      expect(runDetails.flow.actions.length).toBe(1);
    });

    it('calculates proposal metrics (acceptance rate, decline rate, avg time to decision)', async () => {
      const now = Date.now();
      const sampleActions: Partial<AgentActionEntity>[] = [
        {
          id: 'ACT-01',
          type: 'REFERRAL',
          status: 'APPROVED',
          createdAt: new Date(now - 3600 * 1000),
          decidedAt: new Date(now - 3000 * 1000), // 600 seconds = 600,000 ms
        },
        {
          id: 'ACT-02',
          type: 'REFERRAL',
          status: 'DECLINED',
          createdAt: new Date(now - 3600 * 1000),
          decidedAt: new Date(now - 3300 * 1000), // 300 seconds = 300,000 ms
        },
        {
          id: 'ACT-03',
          type: 'LAB_ORDER',
          status: 'EXPIRED',
          createdAt: new Date(now - 3600 * 1000),
        },
      ];

      mockActionRepo.find.mockResolvedValue(sampleActions);

      const metrics = await runsService.proposalMetrics(24);

      expect(metrics.totalProposals).toBe(3);
      expect(metrics.approved).toBe(1);
      expect(metrics.declined).toBe(1);
      expect(metrics.expired).toBe(1);
      expect(metrics.acceptanceRate).toBe(0.5); // 1 approved out of 2 resolved
      expect(metrics.declineRate).toBe(0.5); // 1 declined out of 2 resolved
      expect(metrics.avgTimeToDecisionMs).toBe(450000); // (600,000 + 300,000) / 2
      expect(metrics.byType.REFERRAL).toBe(2);
      expect(metrics.byType.LAB_ORDER).toBe(1);
    });
  });
});
