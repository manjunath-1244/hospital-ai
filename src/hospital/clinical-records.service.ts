import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ConsultationEntity } from '../database/entities/consultation.entity';
import { VitalsEntity } from '../database/entities/vitals.entity';
import { ImagingStudyEntity } from '../database/entities/imaging-study.entity';
import { PatientEntity } from '../database/entities/patient.entity';
import { newId } from '../common/ids';
import { VisitEntity } from '../database/entities/visit.entity';
import { WAITING_STATUSES } from './visits/visit-status';
import { VisitsService } from './visits/visits.service';
import { AuthUser } from '../security/auth-user';

/** Persistence for encounter-level records: consultations, vitals, imaging studies. */
@Injectable()
export class ClinicalRecordsService {
  constructor(
    @InjectRepository(ConsultationEntity)
    private readonly consultations: Repository<ConsultationEntity>,
    @InjectRepository(VitalsEntity)
    private readonly vitals: Repository<VitalsEntity>,
    @InjectRepository(ImagingStudyEntity)
    private readonly imaging: Repository<ImagingStudyEntity>,
    private readonly dataSource: DataSource,
    private readonly visits: VisitsService,
  ) {}

  /**
   * Saves the consultation, updates the patient chart and moves the visit into consultation, atomically:
   * all of it happens or none of it does.
   */
  saveConsultation(
    patient: PatientEntity,
    visitId: string,
    actor: AuthUser,
    data: Omit<ConsultationEntity, 'id' | 'createdAt' | 'visitId'>,
  ): Promise<ConsultationEntity> {
    return this.dataSource.transaction(async (m) => {
      const consultation = await m.save(
        ConsultationEntity,
        m.create(ConsultationEntity, {
          ...data,
          visitId,
          id: newId('CON-'),
        }),
      );

      const conditions = new Set(patient.conditions);
      conditions.add(data.diagnosis);
      const meds = new Set(patient.currentMedications);
      data.prescriptions.forEach((p) => meds.add(p));
      patient.conditions = [...conditions];
      patient.currentMedications = [...meds];
      await m.save(PatientEntity, patient);
      // The first consultation starts the consultation; later ones inside an ongoing visit leave the status alone.
      const visit = await m.findOneByOrFail(VisitEntity, { id: visitId });
      if ((WAITING_STATUSES as readonly string[]).includes(visit.status)) {
        await this.visits.transition(visit, 'IN_CONSULTATION', actor, {
          manager: m,
        });
      }
      return consultation;
    });
  }

  listConsultations(patientId: string, limit = 10) {
    return this.consultations.find({
      where: { patientId: patientId.toUpperCase() },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  recentConsultations(limit = 50) {
    return this.consultations.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  addVitals(v: Omit<VitalsEntity, 'id' | 'recordedAt'>) {
    return this.vitals.save(this.vitals.create({ ...v, id: newId('VIT-') }));
  }

  listVitals(patientId: string, limit = 20) {
    return this.vitals.find({
      where: { patientId: patientId.toUpperCase() },
      order: { recordedAt: 'DESC' },
      take: limit,
    });
  }

  /** Most recent vitals row of each given visit (for the ward board). */
  async latestVitalsPerVisit(visitIds: string[]): Promise<VitalsEntity[]> {
    if (!visitIds.length) return [];
    const ids: { id: string }[] = await this.vitals
      .createQueryBuilder('v')
      .select('DISTINCT ON (v."visitId") v.id', 'id')
      .where('v."visitId" IN (:...visitIds)', { visitIds })
      .orderBy('v."visitId"')
      .addOrderBy('v."recordedAt"', 'DESC')
      .getRawMany();
    if (!ids.length) return [];
    return this.vitals.find({ where: { id: In(ids.map((r) => r.id)) } });
  }

  addImagingStudy(s: Omit<ImagingStudyEntity, 'id' | 'createdAt'>) {
    return this.imaging.save(this.imaging.create({ ...s, id: newId('IMG-') }));
  }

  updateImagingStudy(id: string, patch: Partial<ImagingStudyEntity>) {
    return this.imaging.update({ id }, patch);
  }

  listImagingStudies(patientId: string) {
    return this.imaging.find({
      where: { patientId: patientId.toUpperCase() },
      order: { createdAt: 'DESC' },
    });
  }

  async getImagingStudy(id: string) {
    const s = await this.imaging.findOne({ where: { id } });
    if (!s) throw new NotFoundException(`Imaging study ${id} not found`);
    return s;
  }
}
