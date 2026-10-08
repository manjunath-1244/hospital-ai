import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FollowUpPlanEntity, FollowUpPlanItem } from '../../database/entities/follow-up-plan.entity';
import { VisitEntity } from '../../database/entities/visit.entity';
import { ConsultationEntity } from '../../database/entities/consultation.entity';
import { SpecialistAssessmentEntity } from '../../database/entities/specialist-assessment.entity';
import { ActionProposalService } from '../../ai/actions/action-proposal.service';
import { AuthUser } from '../../security/auth-user';
import { newId } from '../../common/ids';

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(
    @InjectRepository(FollowUpPlanEntity)
    private readonly planRepo: Repository<FollowUpPlanEntity>,
    @InjectRepository(VisitEntity)
    private readonly visitRepo: Repository<VisitEntity>,
    @InjectRepository(ConsultationEntity)
    private readonly consultRepo: Repository<ConsultationEntity>,
    @InjectRepository(SpecialistAssessmentEntity)
    private readonly assessmentRepo: Repository<SpecialistAssessmentEntity>,
    private readonly proposalService: ActionProposalService,
  ) {}

  async generateProposal(
    visitId: string,
    createdBy: AuthUser,
  ): Promise<{ plan: FollowUpPlanEntity; proposalAction: any }> {
    const visit = await this.visitRepo.findOne({ where: { id: visitId } });
    if (!visit) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }

    const consults = await this.consultRepo.find({
      where: { patientId: visit.patientId },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    const assessments = await this.assessmentRepo.find({
      where: { visitId },
      order: { completedAt: 'DESC' },
      take: 1,
    });

    const items: FollowUpPlanItem[] = [];

    // Item 1: Follow-up Appointment
    const targetSpecialty = assessments.length ? assessments[0].specialty : 'General Practice';
    items.push({
      type: 'APPOINTMENT',
      summary: `Follow-up appointment with ${targetSpecialty} in 4 weeks`,
      details: { specialty: targetSpecialty, timeframe: '4 weeks' },
    });

    // Item 2: Follow-up Lab Order
    const testName = targetSpecialty.toLowerCase().includes('cardio')
      ? 'Troponin T & Lipid Panel'
      : 'Comprehensive Metabolic Panel';
    items.push({
      type: 'LAB_ORDER',
      summary: `Order follow-up lab test: ${testName}`,
      details: { testName },
    });

    // Item 3: Care Coordinator Task
    items.push({
      type: 'TASK',
      summary: 'Coordinate post-discharge medications & appointment scheduling',
      details: { assignedToRole: 'CARE_COORDINATOR', priority: 'HIGH' },
    });

    // Item 4: Patient Notice
    items.push({
      type: 'PATIENT_NOTICE',
      summary: 'Send follow-up care instructions to patient',
      details: { channel: 'STUB', message: 'Please follow your post-discharge instructions and attend your follow-up appointment.' },
    });

    const plan = this.planRepo.create({
      id: newId('FUP', 6),
      visitId: visit.id,
      patientId: visit.patientId,
      createdFromRequestId: assessments.length ? assessments[0].requestId : null,
      items,
      status: 'PROPOSED',
    });

    const savedPlan = await this.planRepo.save(plan);

    // Propose FOLLOW_UP action via ActionProposalService (W6 approval layer)
    const proposalAction = await this.proposalService.propose(
      {
        type: 'FOLLOW_UP',
        patientId: visit.patientId,
        visitId: visit.id,
        payload: {
          planId: savedPlan.id,
          visitId: visit.id,
          patientId: visit.patientId,
          itemCount: items.length,
          items,
        },
      },
      createdBy,
    );

    return { plan: savedPlan, proposalAction };
  }

  async getPlanForVisit(visitId: string): Promise<FollowUpPlanEntity | null> {
    return this.planRepo.findOne({
      where: { visitId },
      order: { createdAt: 'DESC' },
    });
  }
}
