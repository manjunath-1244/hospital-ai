import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import {
  ConsultationStatus,
  PatientEntity,
} from '../database/entities/patient.entity';
import { LabResultEntity } from '../database/entities/lab-result.entity';
import { AppointmentEntity } from '../database/entities/appointment.entity';
import { StaffTaskEntity } from '../database/entities/staff-task.entity';
import { ImagingStudyEntity } from '../database/entities/imaging-study.entity';
import { VitalsEntity } from '../database/entities/vitals.entity';
import { ConsultationEntity } from '../database/entities/consultation.entity';
import { ChatThreadEntity } from '../database/entities/chat-thread.entity';
import { newId } from '../common/ids';
import { TaskPriority } from './hospital.types';

export interface NewPatient {
  name: string;
  age: number;
  gender: string;
  phone: string;
  bloodType: string;
  chiefComplaint?: string;
}

/** Data access for patients, labs, appointments and staff tasks. No integration or messaging concerns live here. */
@Injectable()
export class HospitalService {
  private readonly logger = new Logger(HospitalService.name);

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
  ) {}

  // --- Patients ---
  async listPatients(
    opts: {
      q?: string;
      limit?: number;
      offset?: number;
      status?: ConsultationStatus;
    } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const q = opts.q?.trim();
    const status = opts.status ? { consultationStatus: opts.status } : {};
    const where = q
      ? [
          { name: ILike(`%${q}%`), ...status },
          { id: ILike(`%${q}%`), ...status },
        ]
      : opts.status
        ? status
        : undefined;
    const [items, total] = await this.patients.findAndCount({
      where,
      order: { registeredAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total };
  }

  /**
   * Patients a free-text message refers to, by id (P1001) or by name (full name, or a distinctive first/last name
   * that matches exactly one patient). Ambiguous first names are skipped rather than guessed.
   */
  async findMentioned(message: string, max = 3): Promise<PatientEntity[]> {
    const text = message.toLowerCase();
    const all = await this.patients.find();
    const hits = new Map<string, PatientEntity>();
    for (const p of all) {
      if (
        new RegExp(`(^|[^a-z0-9])${p.id.toLowerCase()}([^a-z0-9]|$)`).test(text)
      )
        hits.set(p.id, p);
    }
    const named = all.filter((p) => text.includes(p.name.toLowerCase()));
    named.forEach((p) => hits.set(p.id, p));
    if (!named.length) {
      const wordHit = (token: string) =>
        new RegExp(`(^|[^a-z])${token}([^a-z]|$)`).test(text);
      // Words that are also ordinary vocabulary must never be treated as a patient's name (e.g. a patient called "Test Patient").
      const COMMON = new Set([
        'patient',
        'patients',
        'test',
        'check',
        'persist',
        'journey',
        'sample',
        'demo',
        'user',
        'name',
        'doctor',
        'nurse',
        'what',
        'when',
        'with',
        'from',
        'that',
        'this',
        'have',
        'been',
        'does',
        'show',
        'list',
        'give',
      ]);
      const tokenOwners = new Map<string, PatientEntity[]>();
      for (const p of all) {
        for (const t of p.name
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length >= 4 && !COMMON.has(t))) {
          tokenOwners.set(t, [...(tokenOwners.get(t) ?? []), p]);
        }
      }
      for (const [token, owners] of tokenOwners) {
        if (owners.length === 1 && wordHit(token))
          hits.set(owners[0].id, owners[0]);
      }
    }
    return [...hits.values()].slice(0, max);
  }

  async getAllPatientNames(): Promise<string[]> {
    const rows = await this.patients.find({ select: { name: true } });
    return rows.map((r) => r.name);
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
  async createPatient(input: NewPatient): Promise<PatientEntity> {
    const dob = `${new Date().getUTCFullYear() - input.age}-01-01`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const entity = this.patients.create({
        id: newId('P', 6),
        name: input.name,
        age: input.age,
        gender: input.gender,
        dob,
        phone: input.phone,
        bloodType: input.bloodType,
        allergies: [],
        currentMedications: [],
        conditions: [],
        chiefComplaint: input.chiefComplaint ?? null,
        consultationStatus: 'WAITING',
        consultedAt: null,
        waitAlertedAt: null,
        fhirSynced: false,
        closedAt: null,
        closedBy: null,
        closeReason: null,
      });
      try {
        // insert (not save): a duplicate id must fail rather than silently update an existing patient
        await this.patients.insert(entity);
        return this.getPatientById(entity.id);
      } catch (err: any) {
        if (err?.code !== '23505') throw err; // unique_violation -> retry with a new id
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

  findWaitingLongerThan(minutes: number, onlyUnalerted = false) {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const qb = this.patients
      .createQueryBuilder('p')
      .where(`p."consultationStatus" = 'WAITING'`)
      .andWhere('p."registeredAt" < :cutoff', { cutoff })
      .orderBy('p."registeredAt"', 'ASC');
    if (onlyUnalerted) qb.andWhere('p."waitAlertedAt" IS NULL');
    return qb.getMany();
  }

  findWaiting() {
    return this.patients.find({
      where: { consultationStatus: 'WAITING' },
      order: { registeredAt: 'ASC' },
    });
  }

  markWaitAlerted(ids: string[]) {
    if (!ids.length) return Promise.resolve();
    return this.patients
      .createQueryBuilder()
      .update()
      .set({ waitAlertedAt: () => 'now()' })
      .whereInIds(ids)
      .execute();
  }

  /** Closes the patient's session: no new clinical writes until reopened. */
  async closePatient(id: string, by: string, reason?: string) {
    const p = await this.getPatientById(id);
    if (p.consultationStatus === 'CLOSED') return p;
    p.consultationStatus = 'CLOSED';
    p.closedAt = new Date();
    p.closedBy = by;
    p.closeReason = reason?.trim() || null;
    return this.patients.save(p);
  }

  async reopenPatient(id: string) {
    const p = await this.getPatientById(id);
    if (p.consultationStatus !== 'CLOSED') return p;
    p.consultationStatus = p.consultedAt ? 'SEEN' : 'WAITING';
    p.closedAt = null;
    p.closedBy = null;
    p.closeReason = null;
    p.waitAlertedAt = null;
    return this.patients.save(p);
  }

  /** Permanently removes the patient and every record that belongs to them, atomically. */
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
      };
      // Identical DICOM files are stored once in the PACS and shared. Only remove an image from the PACS when no other
      // study still points at it.
      const stillUsed = new Set<string>();
      for (const id of orthancInstanceIds) {
        if (
          await m.count(ImagingStudyEntity, {
            where: { orthancInstanceId: id },
          })
        )
          stillUsed.add(id);
      }
      orthancInstanceIds.splice(
        0,
        orthancInstanceIds.length,
        ...orthancInstanceIds.filter((id) => !stillUsed.has(id)),
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

  /** Headline numbers for the agent and dashboards. */
  async overview() {
    const byStatus: { status: string; n: string }[] = await this.patients
      .createQueryBuilder('p')
      .select('p."consultationStatus"', 'status')
      .addSelect('count(*)', 'n')
      .groupBy('p."consultationStatus"')
      .getRawMany();
    const count = (s: string) =>
      Number(byStatus.find((r) => r.status === s)?.n ?? 0);
    const oldest = await this.patients.findOne({
      where: { consultationStatus: 'WAITING' },
      order: { registeredAt: 'ASC' },
    });
    const dayAgo = new Date(Date.now() - 24 * 3_600_000);
    const criticalLabs24h = await this.labs
      .createQueryBuilder('l')
      .where('l.status = :s', { s: 'CRITICAL' })
      .andWhere('l."createdAt" > :d', { d: dayAgo })
      .getCount();
    const pendingTasks = await this.tasks.count({
      where: { status: 'PENDING' },
    });
    const scheduled = await this.appointments.count({
      where: { status: 'SCHEDULED' },
    });
    return {
      totalPatients: byStatus.reduce((a, r) => a + Number(r.n), 0),
      waitingForDoctor: count('WAITING'),
      seen: count('SEEN'),
      closed: count('CLOSED'),
      longestWaitMinutes: oldest
        ? Math.floor((Date.now() - oldest.registeredAt.getTime()) / 60_000)
        : 0,
      criticalLabsLast24h: criticalLabs24h,
      pendingStaffTasks: pendingTasks,
      scheduledAppointments: scheduled,
    };
  }

  getAppointmentsForPatient(patientId: string) {
    return this.appointments.find({
      where: { patientId: patientId.toUpperCase() },
      order: { dateTime: 'ASC' },
    });
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

  async bookAppointment(
    patientId: string,
    doctorName: string,
    department: string,
    dateTime: string,
    reason: string,
  ) {
    const patient = await this.getPatientById(patientId);
    if (patient.consultationStatus === 'CLOSED') {
      throw new ConflictException(
        `Patient ${patient.id} session is closed. Reopen it before booking.`,
      );
    }
    return this.dataSource.transaction(async (m) => {
      const existing = await m.findOne(AppointmentEntity, {
        where: { doctorName, dateTime, status: 'SCHEDULED' },
        lock: { mode: 'pessimistic_write' },
      });
      if (existing)
        throw new ConflictException(
          `Time slot ${dateTime} is already booked for ${doctorName}`,
        );
      const apt = m.create(AppointmentEntity, {
        id: newId('APT-'),
        patientId: patientId.toUpperCase(),
        doctorName,
        department,
        dateTime,
        status: 'SCHEDULED',
        reason,
      });
      return m.save(apt);
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

  createTask(
    title: string,
    assignedTo: string,
    patientId?: string,
    priority: TaskPriority = 'MEDIUM',
  ) {
    return this.tasks.save(
      this.tasks.create({
        id: newId('TSK-'),
        title,
        assignedTo,
        patientId: patientId ? patientId.toUpperCase() : null,
        priority,
        status: 'PENDING',
      }),
    );
  }
}
