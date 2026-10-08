import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ConsultationEntity } from '../database/entities/consultation.entity';
import { VitalsEntity } from '../database/entities/vitals.entity';
import { ImagingStudyEntity } from '../database/entities/imaging-study.entity';
import { PatientEntity } from '../database/entities/patient.entity';
import { newId } from '../common/ids';

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
  ) {}

  /** Saves the consultation and updates the patient chart atomically: both happen or neither does. */
  saveConsultation(
    patient: PatientEntity,
    data: Omit<ConsultationEntity, 'id' | 'createdAt'>,
  ): Promise<ConsultationEntity> {
    return this.dataSource.transaction(async (m) => {
      const consultation = await m.save(
        ConsultationEntity,
        m.create(ConsultationEntity, { ...data, id: newId('CON-') }),
      );

      const conditions = new Set(patient.conditions);
      conditions.add(data.diagnosis);
      const meds = new Set(patient.currentMedications);
      data.prescriptions.forEach((p) => meds.add(p));
      patient.conditions = [...conditions];
      patient.currentMedications = [...meds];
      patient.consultationStatus = 'SEEN';
      patient.consultedAt = consultation.createdAt;
      await m.save(PatientEntity, patient);
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

  /** Most recent vitals row per patient (for the ward board). */
  async latestVitalsPerPatient(): Promise<VitalsEntity[]> {
    const ids: { id: string }[] = await this.vitals
      .createQueryBuilder('v')
      .select('DISTINCT ON (v."patientId") v.id', 'id')
      .orderBy('v."patientId"')
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
