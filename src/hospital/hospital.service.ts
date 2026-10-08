import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, Repository } from 'typeorm';
import { PatientEntity } from '../database/entities/patient.entity';
import { LabResultEntity } from '../database/entities/lab-result.entity';
import { AppointmentEntity } from '../database/entities/appointment.entity';
import { StaffTaskEntity } from '../database/entities/staff-task.entity';
import { ImagingStudyEntity } from '../database/entities/imaging-study.entity';
import { VitalsEntity } from '../database/entities/vitals.entity';
import { ConsultationEntity } from '../database/entities/consultation.entity';
import { ChatThreadEntity } from '../database/entities/chat-thread.entity';
import { newId } from '../common/ids';
import { TaskPriority } from './hospital.types';
import { findMentionedPatients } from './mention-matching';
import { resolveBirth } from './patient-identity';
import { VisitsService } from './visits/visits.service';

export interface NewPatient {
  name: string;
  gender: string;
  phone: string;
  bloodType: string;
  /** Provide an age OR a real date of birth (a real one wins). */
  age?: number;
  dob?: string | null;
}

/**
 * Data access for the PERSON (patients) and the records not tied to a workflow step (labs, appointments, tasks).
 * Where a patient is in their care is the business of `VisitsService`, not of this class.
 */
@Injectable()
export class HospitalService {
  constructor(
    @InjectRepository(PatientEntity)
    private readonly patients: Repository<PatientEntity>,
    @InjectRepository(LabResultEntity)
    private readonly labs: Repository<LabResultEntity>,
    @InjectRepository(AppointmentEntity)
    private readonly appointments: Repository<AppointmentEntity>,
    @InjectRepository(StaffTaskEntity)
    private readonly tasks: Repository<StaffTaskEntity>,
    private readonly dataSource: DataSource,
    private readonly visits: VisitsService,
  ) {}

  // --- Patients (the person) ---
  async listPatients(
    opts: { q?: string; limit?: number; offset?: number } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const q = opts.q?.trim();
    const where = q
      ? [{ name: ILike(`%${q}%`) }, { id: ILike(`%${q}%`) }]
      : undefined;
    const [items, total] = await this.patients.findAndCount({
      where,
      order: { registeredAt: 'DESC' },
      take: limit,
      skip: Math.max(opts.offset ?? 0, 0),
    });
    return { items, total };
  }

  /** Patients a message refers to by id or name (see `mention-matching.ts`). */
  async findMentioned(message: string, max = 3): Promise<PatientEntity[]> {
    return findMentionedPatients(message, await this.patients.find(), max);
  }

  async getAllPatientNames(): Promise<string[]> {
    return (await this.patients.find({ select: { name: true } })).map(
      (r) => r.name,
    );
  }

  /** Candidates for duplicate detection: same name or same phone digits. */
  findDuplicateCandidates(
    name: string,
    phoneDigits: string,
  ): Promise<PatientEntity[]> {
    const qb = this.patients
      .createQueryBuilder('p')
      .where('lower(p."name") = lower(:name)', { name: name.trim() });
    if (phoneDigits.length >= 7) {
      qb.orWhere(`regexp_replace(p."phone", '\\D', '', 'g') LIKE :suffix`, {
        suffix: `%${phoneDigits.slice(-7)}`,
      });
    }
    return qb.limit(10).getMany();
  }

  async getPatientById(id: string): Promise<PatientEntity> {
    const patient = await this.patients.findOne({
      where: { id: id.trim().toUpperCase() },
    });
    if (!patient)
      throw new NotFoundException(`Patient with ID ${id} not found`);
    return patient;
  }

  /** Creates a patient with a collision-resistant id. The primary key guarantees we never overwrite someone else. */
  async createPatient(
    input: NewPatient,
    manager?: EntityManager,
  ): Promise<PatientEntity> {
    const birth = resolveBirth({ age: input.age, dob: input.dob });
    const repo = manager ? manager.getRepository(PatientEntity) : this.patients;
    for (let attempt = 0; attempt < 5; attempt++) {
      const entity = repo.create({
        id: newId('P', 6),
        name: input.name,
        age: birth.age,
        gender: input.gender,
        dob: birth.dob,
        dobApproximate: birth.dobApproximate,
        phone: input.phone,
        bloodType: input.bloodType,
        allergies: [],
        currentMedications: [],
        conditions: [],
        fhirSynced: false,
      });
      try {
        // insert (not save): a duplicate id must fail rather than silently update an existing patient
        await repo.insert(entity);
        return await repo.findOneOrFail({ where: { id: entity.id } });
      } catch (err: any) {
        if (err?.code !== '23505') throw err; // unique_violation -> retry with a new id
        if (manager) throw err; // a failed statement poisons the surrounding transaction; let the caller retry it
      }
    }
    throw new ConflictException(
      'Could not allocate a unique patient id, please retry',
    );
  }

  savePatient(patient: PatientEntity) {
    return this.patients.save(patient);
  }

  markFhirSynced(id: string) {
    return this.patients.update({ id }, { fhirSynced: true });
  }

  /** Permanently removes the patient and every record that belongs to them (all visits included), atomically. */
  async deletePatientCascade(id: string) {
    const pid = (await this.getPatientById(id)).id;
    const orthancInstanceIds: string[] = [];
    const deleted = await this.dataSource.transaction(async (m) => {
      const imaging = await m.find(ImagingStudyEntity, {
        where: { patientId: pid },
      });
      imaging.forEach(
        (i) =>
          i.orthancInstanceId && orthancInstanceIds.push(i.orthancInstanceId),
      );
      const count = async (entity: any) =>
        (await m.delete(entity, { patientId: pid })).affected ?? 0;
      const result = {
        labs: await count(LabResultEntity),
        vitals: await count(VitalsEntity),
        consultations: await count(ConsultationEntity),
        imaging: await count(ImagingStudyEntity),
        appointments: await count(AppointmentEntity),
        tasks: await count(StaffTaskEntity),
        visits: await this.visits.deleteForPatient(pid, m),
      };
      // Identical DICOM files are stored once in the PACS and shared: only remove an image when no other study uses it.
      const stillUsed = new Set<string>();
      for (const instanceId of orthancInstanceIds) {
        if (
          await m.count(ImagingStudyEntity, {
            where: { orthancInstanceId: instanceId },
          })
        )
          stillUsed.add(instanceId);
      }
      orthancInstanceIds.splice(
        0,
        orthancInstanceIds.length,
        ...orthancInstanceIds.filter((i) => !stillUsed.has(i)),
      );
      await m.update(
        ChatThreadEntity,
        { activePatientId: pid },
        { activePatientId: null },
      );
      await m.delete(PatientEntity, { id: pid });
      return result;
    });
    return { patientId: pid, deleted, orthancInstanceIds };
  }

  // --- Labs ---
  async getPatientLabs(patientId: string): Promise<LabResultEntity[]> {
    await this.getPatientById(patientId);
    return this.labs.find({
      where: { patientId: patientId.toUpperCase() },
      order: { createdAt: 'DESC' },
    });
  }

  async addLab(
    lab: Omit<LabResultEntity, 'id' | 'createdAt'>,
  ): Promise<LabResultEntity> {
    return this.labs.save(this.labs.create({ ...lab, id: newId('LAB-') }));
  }

  async getPatientMedications(patientId: string) {
    const patient = await this.getPatientById(patientId);
    return {
      medications: patient.currentMedications,
      allergies: patient.allergies,
    };
  }

  // --- Appointments (ACID: unique partial index + row lock) ---
  getAppointments() {
    return this.appointments.find({ order: { dateTime: 'ASC' } });
  }

  getAppointmentsForPatient(patientId: string) {
    return this.appointments.find({
      where: { patientId: patientId.toUpperCase() },
      order: { dateTime: 'ASC' },
    });
  }

  /** The caller supplies the visit (the workflow layer resolves/validates it). */
  async bookAppointment(input: {
    patientId: string;
    visitId: string | null;
    doctorName: string;
    department: string;
    dateTime: string;
    reason: string;
  }) {
    await this.getPatientById(input.patientId);
    return this.dataSource.transaction(async (m) => {
      const existing = await m.findOne(AppointmentEntity, {
        where: {
          doctorName: input.doctorName,
          dateTime: input.dateTime,
          status: 'SCHEDULED',
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing)
        throw new ConflictException(
          `Time slot ${input.dateTime} is already booked for ${input.doctorName}`,
        );
      return m.save(
        m.create(AppointmentEntity, {
          id: newId('APT-'),
          patientId: input.patientId.toUpperCase(),
          visitId: input.visitId,
          doctorName: input.doctorName,
          department: input.department,
          dateTime: input.dateTime,
          status: 'SCHEDULED',
          reason: input.reason,
        }),
      );
    });
  }

  // --- Staff tasks ---
  getTasksForPatient(patientId: string) {
    return this.tasks.find({
      where: { patientId: patientId.toUpperCase() },
      order: { createdAt: 'DESC' },
    });
  }

  getTasks() {
    return this.tasks.find({ order: { createdAt: 'DESC' } });
  }

  createTask(input: {
    title: string;
    assignedTo: string;
    patientId?: string;
    visitId?: string | null;
    priority?: TaskPriority;
  }) {
    return this.tasks.save(
      this.tasks.create({
        id: newId('TSK-'),
        title: input.title,
        assignedTo: input.assignedTo,
        patientId: input.patientId ? input.patientId.toUpperCase() : null,
        visitId: input.visitId ?? null,
        priority: input.priority ?? 'MEDIUM',
        status: 'PENDING',
      }),
    );
  }
}
