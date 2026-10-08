import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from './entities/user.entity';
import { PatientEntity } from './entities/patient.entity';
import { LabResultEntity } from './entities/lab-result.entity';
import { VisitsService } from '../hospital/visits/visits.service';
import type { VisitStatus } from '../hospital/visits/visit-status';
import type { AuthUser } from '../security/auth-user';
import { DoctorAvailabilityEntity } from './entities/doctor-availability.entity';
import { newId } from '../common/ids';
import type { UserRole } from '../security/roles.decorator';

interface SeedUser {
  username: string;
  displayName: string;
  role: UserRole;
  specialty?: string;
  department?: string;
}

const USERS: SeedUser[] = [
  {
    username: 'receptionist',
    displayName: 'Alex Rivera (Front Desk)',
    role: 'RECEPTIONIST',
  },
  { username: 'nurse', displayName: 'Kelly Nguyen, RN', role: 'NURSE' },
  { username: 'doctor', displayName: 'Dr. Sarah Jenkins', role: 'DOCTOR' },
  {
    username: 'radiologist',
    displayName: 'Dr. Omar Haddad (Radiology)',
    role: 'RADIOLOGIST',
  },
  {
    username: 'pharmacist',
    displayName: 'Priya Shah, PharmD',
    role: 'PHARMACIST',
  },
  {
    username: 'coordinator',
    displayName: 'Jordan Lee (Care Coordination)',
    role: 'CARE_COORDINATOR',
  },
  { username: 'admin', displayName: 'System Administrator', role: 'ADMIN' },
  {
    username: 'cardiologist',
    displayName: 'Dr. Sarah Wilson (Cardiology)',
    role: 'SPECIALIST',
    specialty: 'Cardiology',
    department: 'Cardiology',
  },
  {
    username: 'neurologist',
    displayName: 'Dr. Michael Chen (Neurology)',
    role: 'SPECIALIST',
    specialty: 'Neurology',
    department: 'Neurology',
  },
];

/** Default consulting hours for seeded specialists: Monday to Friday, 09:00-17:00 UTC, 30-minute slots. */
const SEED_WORKING_DAYS = [1, 2, 3, 4, 5];
const SEED_HOURS = { startTime: '09:00', endTime: '17:00', slotMinutes: 30 };

const DEMO_PATIENTS: Array<Partial<PatientEntity>> = [
  {
    id: 'P1001',
    name: 'Eleanor Vance',
    age: 45,
    gender: 'female',
    dob: '1981-05-14',
    phone: '+1-555-0147',
    bloodType: 'A+',
    allergies: ['Penicillin', 'Sulfa drugs'],
    currentMedications: ['Lisinopril 10mg', 'Metformin 500mg'],
    conditions: ['Hypertension', 'Type 2 Diabetes'],
  },
  {
    id: 'P1002',
    name: 'Marcus Brody',
    age: 62,
    gender: 'male',
    dob: '1964-11-20',
    phone: '+1-555-0198',
    bloodType: 'O-',
    allergies: ['Aspirin'],
    currentMedications: ['Atorvastatin 20mg', 'Amlodipine 5mg'],
    conditions: ['Hyperlipidemia', 'Coronary Artery Disease'],
  },
  {
    id: 'P1003',
    name: 'Sophia Martinez',
    age: 29,
    gender: 'female',
    dob: '1997-03-08',
    phone: '+1-555-0312',
    bloodType: 'B+',
    allergies: [],
    currentMedications: ['Albuterol Inhaler'],
    conditions: ['Mild Asthma'],
  },
];

/**
 * Where each demo patient is in their care, so a fresh install shows every stage of the queue.
 * Each entry walks the real workflow (start -> triage -> consultation), so seeded data obeys the same rules as live data.
 */
const DEMO_VISITS: Array<{
  patientId: string;
  chiefComplaint: string;
  upTo: VisitStatus;
}> = [
  {
    patientId: 'P1001',
    chiefComplaint: 'Diabetes follow-up',
    upTo: 'IN_CONSULTATION',
  },
  {
    patientId: 'P1002',
    chiefComplaint: 'Chest tightness on exertion',
    upTo: 'TRIAGED',
  },
  { patientId: 'P1003', chiefComplaint: 'Wheezing', upTo: 'WAITING_TRIAGE' },
];
const SEED_ACTOR: AuthUser = {
  userId: 'seed',
  userName: 'seed',
  role: 'ADMIN',
};
const WORKFLOW_PATH: VisitStatus[] = [
  'WAITING_TRIAGE',
  'TRIAGED',
  'IN_CONSULTATION',
];

/** First-boot seeding: staff accounts (bcrypt-hashed) and, optionally, demo patients. Idempotent. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(PatientEntity)
    private readonly patients: Repository<PatientEntity>,
    @InjectRepository(LabResultEntity)
    private readonly labs: Repository<LabResultEntity>,
    @InjectRepository(DoctorAvailabilityEntity)
    private readonly hours: Repository<DoctorAvailabilityEntity>,
    private readonly visits: VisitsService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedUsers();
    await this.ensureSpecialists();
    if (this.config.get('SEED_DEMO_DATA') !== 'false')
      await this.seedDemoPatients();
  }

  private async seedUsers() {
    if ((await this.users.count()) > 0) return;
    let password = this.config.get<string>('SEED_USER_PASSWORD');
    if (!password) {
      password = randomBytes(9).toString('base64url');
      this.logger.warn(
        `SEED_USER_PASSWORD not set; generated a one-time password for all seeded users: ${password}`,
      );
    }
    const hash = await bcrypt.hash(password, 12);
    await this.users.save(
      USERS.map((u) => ({
        ...u,
        id: `USR-${u.username.toUpperCase()}`,
        passwordHash: hash,
      })),
    );
    this.logger.log(
      `Seeded ${USERS.length} staff accounts (${USERS.map((u) => u.username).join(', ')}).`,
    );
  }

  /**
   * Accounts added after the first install (existing databases): create any seeded specialist that is missing
   * and give them working hours. Needs SEED_USER_PASSWORD (a generated one could not be shown for a later account).
   */
  private async ensureSpecialists() {
    for (const u of USERS.filter((x) => x.role === 'SPECIALIST')) {
      const existing = await this.users.findOne({
        where: { username: u.username },
      });
      if (!existing) {
        const password = this.config.get<string>('SEED_USER_PASSWORD');
        if (!password) {
          this.logger.warn(
            `Specialist '${u.username}' not created: set SEED_USER_PASSWORD to add accounts to an existing database.`,
          );
          continue;
        }
        await this.users.save(
          this.users.create({
            ...u,
            specialty: u.specialty ?? null,
            department: u.department ?? null,
            isAvailable: true,
            id: `USR-${u.username.toUpperCase()}`,
            passwordHash: await bcrypt.hash(password, 12),
          }),
        );
        this.logger.log(`Seeded specialist account '${u.username}'.`);
      }
      const id = existing?.id ?? `USR-${u.username.toUpperCase()}`;
      if ((await this.hours.count({ where: { doctorId: id } })) === 0) {
        await this.hours.save(
          SEED_WORKING_DAYS.map((weekday) =>
            this.hours.create({
              id: newId('AVL-'),
              doctorId: id,
              weekday,
              ...SEED_HOURS,
            }),
          ),
        );
      }
    }
  }

  private async seedDemoPatients() {
    if ((await this.patients.count()) > 0) return;
    await this.patients.save(
      DEMO_PATIENTS.map((p) =>
        this.patients.create({ ...p, fhirSynced: false }),
      ),
    );
    await this.labs.save(
      this.labs.create({
        id: 'LAB-501',
        patientId: 'P1001',
        testName: 'HbA1c (Glycated Hemoglobin)',
        value: '7.8',
        unit: '%',
        referenceRange: '4.0 - 5.6',
        status: 'ABNORMAL',
        date: new Date().toISOString().slice(0, 10),
        recordedBy: 'seed',
      }),
    );
    await this.labs.save(
      this.labs.create({
        id: 'LAB-502',
        patientId: 'P1001',
        testName: 'Creatinine',
        value: '1.9',
        unit: 'mg/dL',
        referenceRange: '0.6 - 1.1',
        status: 'ABNORMAL',
        date: new Date().toISOString().slice(0, 10),
        recordedBy: 'seed',
      }),
    );
    for (const dv of DEMO_VISITS) {
      const visit = await this.visits.start(dv.patientId, {
        chiefComplaint: dv.chiefComplaint,
        actor: SEED_ACTOR,
      });
      for (const step of WORKFLOW_PATH.slice(
        1,
        WORKFLOW_PATH.indexOf(dv.upTo) + 1,
      ))
        await this.visits.transition(visit.id, step, SEED_ACTOR);
    }
    this.logger.log(
      `Seeded ${DEMO_PATIENTS.length} demo patients with visits.`,
    );
  }
}
