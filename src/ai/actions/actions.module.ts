import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentActionEntity } from '../../database/entities/agent-action.entity';
import { DataModule } from '../../database/data.module';
import { HospitalModule } from '../../hospital/hospital.module';
import { EventsModule } from '../../events/events.module';
import { ActionValidatorService } from './action-validator.service';
import { ActionProposalService } from './action-proposal.service';
import { ActionExecutorService } from './action-executor.service';
import { PendingActionsService } from './pending-actions.service';
import { ActionExpiryService } from './action-expiry.service';
import { ActionsController } from './actions.controller';

import { ConsultationRequestEntity } from '../../database/entities/consultation-request.entity';
import { FollowUpPlanEntity } from '../../database/entities/follow-up-plan.entity';
import { ConsultationEntity } from '../../database/entities/consultation.entity';
import { SpecialistAssessmentEntity } from '../../database/entities/specialist-assessment.entity';
import { VisitEntity } from '../../database/entities/visit.entity';
import { FollowUpService } from '../../hospital/followup/follow-up.service';
import { FollowUpController } from '../../hospital/followup/follow-up.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentActionEntity,
      ConsultationRequestEntity,
      FollowUpPlanEntity,
      ConsultationEntity,
      SpecialistAssessmentEntity,
      VisitEntity,
    ]),
    DataModule,
    HospitalModule,
    EventsModule,
  ],
  controllers: [ActionsController, FollowUpController],
  providers: [
    ActionValidatorService,
    ActionProposalService,
    ActionExecutorService,
    ActionExpiryService,
    PendingActionsService,
    FollowUpService,
  ],
  exports: [
    ActionProposalService,
    ActionExecutorService,
    ActionExpiryService,
    PendingActionsService,
    FollowUpService,
  ],
})
export class ActionsModule {}
