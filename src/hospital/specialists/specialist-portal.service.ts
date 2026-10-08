import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ConsultationRequestEntity } from '../../database/entities/consultation-request.entity';
import { SpecialistAssessmentEntity } from '../../database/entities/specialist-assessment.entity';
import { ReferralService } from '../referrals/referral.service';
import {
  SpecialistSummaryService,
  AiReferralSummary,
} from './specialist-summary.service';
import { AuthUser } from '../../security/auth-user';
import { newId } from '../../common/ids';

export class CompleteConsultationDto {
  @IsString() @MinLength(3) @MaxLength(4000) assessment!: string;
  @IsString() @MinLength(3) @MaxLength(4000) recommendation!: string;
  @IsString() @MinLength(3) @MaxLength(4000) treatment!: string;
  @IsString() @MinLength(3) @MaxLength(4000) followUp!: string;
  /** Tests to repeat/add, e.g. ["Troponin T"]; each becomes a lab order in the follow-up plan. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  followUpTests?: string[];
  /** Days until the patient should be seen again. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  followUpDays?: number;
}

const URGENCY_PRIORITY: Record<string, number> = {
  EMERGENCY: 1,
  URGENT: 2,
  ROUTINE: 3,
};

@Injectable()
export class SpecialistPortalService {
  private readonly logger = new Logger(SpecialistPortalService.name);

  constructor(
    @InjectRepository(ConsultationRequestEntity)
    private readonly referralRepo: Repository<ConsultationRequestEntity>,
    @InjectRepository(SpecialistAssessmentEntity)
    private readonly assessmentRepo: Repository<SpecialistAssessmentEntity>,
    private readonly referralService: ReferralService,
    private readonly summaryService: SpecialistSummaryService,
  ) {}

  async getMyConsultations(
    specialistUser: AuthUser,
  ): Promise<ConsultationRequestEntity[]> {
    const userId = specialistUser.userId || (specialistUser as any).id;
    const userSpecialty = (specialistUser as any).specialty;

    const qb = this.referralRepo.createQueryBuilder('r');
    if (userSpecialty) {
      qb.where(
        '(r.assignedSpecialistId = :userId OR (r.specialty = :specialty AND r.assignedSpecialistId IS NULL))',
        {
          userId,
          specialty: userSpecialty,
        },
      );
    } else {
      qb.where('r.assignedSpecialistId = :userId', { userId });
    }

    const items = await qb.getMany();

    // Sort by Urgency (EMERGENCY > URGENT > ROUTINE), then createdAt DESC
    return items.sort((a, b) => {
      const prioA = URGENCY_PRIORITY[a.urgency] || 99;
      const prioB = URGENCY_PRIORITY[b.urgency] || 99;
      if (prioA !== prioB) return prioA - prioB;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  async getAiSummary(referralId: string): Promise<AiReferralSummary> {
    return this.summaryService.generateSummary(referralId);
  }

  async completeConsultation(
    referralId: string,
    dto: CompleteConsultationDto,
    specialistUser: AuthUser,
  ): Promise<{
    assessment: SpecialistAssessmentEntity;
    referral: ConsultationRequestEntity;
  }> {
    const found = await this.referralRepo.findOne({
      where: { id: referralId },
    });
    if (!found) {
      throw new NotFoundException(`Referral ${referralId} not found`);
    }
    // Only the assigned specialist (or one of the right specialty for an unassigned request) may complete it.
    const referral =
      specialistUser.role === 'ADMIN'
        ? found
        : await this.referralService.assertSpecialistOwns(
            specialistUser.userId,
            referralId,
          );

    if (referral.status === 'COMPLETED' || referral.status === 'CANCELLED') {
      throw new BadRequestException(
        `Referral ${referralId} is already ${referral.status.toLowerCase()}`,
      );
    }

    const userId = specialistUser.userId || (specialistUser as any).id;
    const userName =
      (specialistUser as any).displayName ||
      specialistUser.userName ||
      'Specialist';
    const specialty = (specialistUser as any).specialty || referral.specialty;

    const assessment = this.assessmentRepo.create({
      id: newId('SA', 6),
      requestId: referral.id,
      visitId: referral.visitId,
      patientId: referral.patientId,
      authorId: userId,
      authorName: userName,
      specialty,
      assessment: dto.assessment,
      recommendation: dto.recommendation,
      treatment: dto.treatment,
      followUp: dto.followUp,
      followUpTests: dto.followUpTests ?? [],
      followUpDays: dto.followUpDays ?? null,
    });

    const savedAssessment = await this.assessmentRepo.save(assessment);

    // Transition referral status to COMPLETED (triggers notifications to primary doctor & patient notice)
    // If status is still REQUESTED, transition to ACCEPTED then COMPLETED
    if (referral.status === 'REQUESTED') {
      await this.referralService.transitionStatus(
        referral.id,
        'ACCEPTED',
        specialistUser,
      );
    }
    if (referral.status === 'ACCEPTED' || referral.status === 'REQUESTED') {
      await this.referralService.transitionStatus(
        referral.id,
        'IN_PROGRESS',
        specialistUser,
      );
    }

    const updatedReferral = await this.referralService.transitionStatus(
      referral.id,
      'COMPLETED',
      specialistUser,
    );

    return { assessment: savedAssessment, referral: updatedReferral };
  }
}
