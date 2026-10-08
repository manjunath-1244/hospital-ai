import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentActionEntity } from '../../database/entities/agent-action.entity';
import { DataModule } from '../../database/data.module';
import { HospitalModule } from '../../hospital/hospital.module';
import { EventsModule } from '../../events/events.module';
import { ActionProposalService } from './action-proposal.service';
import { ActionExecutorService } from './action-executor.service';
import { ActionExpiryService } from './action-expiry.service';
import { ActionsController } from './actions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentActionEntity]),
    DataModule,
    HospitalModule,
    EventsModule,
  ],
  controllers: [ActionsController],
  providers: [
    ActionProposalService,
    ActionExecutorService,
    ActionExpiryService,
  ],
  exports: [
    ActionProposalService,
    ActionExecutorService,
    ActionExpiryService,
  ],
})
export class ActionsModule {}
