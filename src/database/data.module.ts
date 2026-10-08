import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from './entities';
import { HospitalService } from '../hospital/hospital.service';
import { ClinicalRecordsService } from '../hospital/clinical-records.service';
import { SeedService } from './seed.service';

/** Persistence layer: entities + data-access services. Depends on nothing else in the app (breaks old Ai<->Hospital cycle). */
@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES)],
  providers: [HospitalService, ClinicalRecordsService, SeedService],
  exports: [TypeOrmModule, HospitalService, ClinicalRecordsService],
})
export class DataModule {}
