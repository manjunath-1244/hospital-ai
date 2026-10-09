import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FollowUpPlanEntity,
  FollowUpPlanItem,
} from '../../database/entities/follow-up-plan.entity';
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
    origin: { threadId?: string; traceId?: string } = {},
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

    if (!assessments.length && !consults.length)
      throw new BadRequestException(
        `Visit ${visitId} has no specialist assessment or consultation yet; there is nothing to base a follow-up plan on.`,
      );

    // Built only from what clinicians recorded: the specialist's assessment first, otherwise the doctor's consultation.
    const a = assessments[0];
    const defaultDays = Number(process.env.FOLLOWUP_DEFAULT_DAYS ?? 28);
    const days = a?.followUpDays ?? defaultDays;
    const items: FollowUpPlanItem[] = [];

    if (a) {
      items.push({
        type: 'APPOINTMENT',
        summary: `Follow-up appointment with ${a.authorName} (${a.specialty}) in ${days} days`,
        details: {
          doctorId: a.authorId,
          doctorName: a.authorName,
          specialty: a.specialty,
          days,
          reason: a.followUp,
        },
      });
      for (const testName of a.followUpTests ?? []) {
        items.push({
          type: 'LAB_ORDER',
          summary: `Order follow-up test: ${testName}`,
          details: { testName },
        });
      }
      items.push({
        type: 'TASK',
        summary: `Carry out specialist recommendation: ${a.recommendation.slice(0, 160)}`,
        details: {
          assignedToRole: 'CARE_COORDINATOR',
          priority: 'HIGH',
          title: `${a.specialty} recommendation: ${a.recommendation.slice(0, 200)}`,
        },
      });
      items.push({
        type: 'PATIENT_NOTICE',
        summary: 'Send follow-up care instructions to the patient',
        details: { channel: 'STUB', message: a.followUp },
      });
    } else {
      const c = consults[0];
      items.push({
        type: 'TASK',
        summary: `Arrange follow-up for diagnosis: ${c.diagnosis}`,
        details: {
          assignedToRole: 'CARE_COORDINATOR',
          priority: 'MEDIUM',
          title: `Follow-up for ${c.diagnosis}`,
        },
      });
      items.push({
        type: 'PATIENT_NOTICE',
        summary: 'Send follow-up care instructions to the patient',
        details: { channel: 'STUB', message: c.notes },
      });
    }

    const plan = this.planRepo.create({
      id: newId('FUP', 6),
      visitId: visit.id,
      patientId: visit.patientId,
      createdFromRequestId: assessments.length
        ? assessments[0].requestId
        : null,
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
        threadId: origin.threadId,
        traceId: origin.traceId,
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
