import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from './entities';
import { HospitalService } from '../hospital/hospital.service';
import { ClinicalRecordsService } from '../hospital/clinical-records.service';
import { VisitsService } from '../hospital/visits/visits.service';
import { PatientDirectoryService } from '../hospital/patient-directory.service';
import { OverviewService } from '../hospital/overview.service';
import { SeedService } from './seed.service';

/** Persistence layer: entities + data-access services. Depends on nothing else in the app (breaks old Ai<->Hospital cycle). */
@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES)],
  providers: [
    HospitalService,
    ClinicalRecordsService,
    VisitsService,
    PatientDirectoryService,
    OverviewService,
    SeedService,
  ],
  exports: [
    TypeOrmModule,
    HospitalService,
    ClinicalRecordsService,
    VisitsService,
    PatientDirectoryService,
    OverviewService,
  ],
})
export class DataModule {}
