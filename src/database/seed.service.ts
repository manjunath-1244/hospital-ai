import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UserEntity } from './entities/user.entity';
import { PatientEntity } from './entities/patient.entity';
import { LabResultEntity } from './entities/lab-result.entity';
import type { UserRole } from '../security/roles.decorator';

const USERS: Array<{ username: string; displayName: string; role: UserRole }> =
  [
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
  ];

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
    chiefComplaint: 'Diabetes follow-up',
    consultationStatus: 'SEEN',
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
    chiefComplaint: 'Chest tightness on exertion',
    consultationStatus: 'SEEN',
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
    chiefComplaint: 'Wheezing',
    consultationStatus: 'SEEN',
  },
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
  ) {}

  async onApplicationBootstrap() {
    await this.seedUsers();
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
    this.logger.log('Seeded 3 demo patients.');
  }
}
