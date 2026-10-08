import { Module } from '@nestjs/common';
import { DataModule } from '../database/data.module';
import { KnowledgeModule } from '../ai/rag/knowledge.module';
import { InteropModule } from '../ai/fhir/interop.module';
import { EventsModule } from '../events/events.module';
import { HospitalController } from './hospital.controller';
import { HospitalLifecycleService } from './hospital-lifecycle.service';
import { News2Service } from './news2.service';
import { MedicationSafetyService } from './medication-safety.service';
import { PatientSummaryService } from './patient-summary.service';
import { PostCommitService } from './post-commit.service';
import { QueueMonitorService } from './queue-monitor.service';

/** Clinical workflows. Depends on data, knowledge, interop and events, but NOT on the AI module (no cycles). */
@Module({
  imports: [DataModule, KnowledgeModule, InteropModule, EventsModule],
  controllers: [HospitalController],
  providers: [
    HospitalLifecycleService,
    News2Service,
    MedicationSafetyService,
    QueueMonitorService,
    PatientSummaryService,
    PostCommitService,
  ],
  exports: [
    HospitalLifecycleService,
    News2Service,
    MedicationSafetyService,
    PatientSummaryService,
  ],
})
export class HospitalModule {}
