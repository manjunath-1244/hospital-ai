import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type ConsultationStatus = 'WAITING' | 'SEEN' | 'CLOSED';

@Entity('patients')
export class PatientEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'int' })
  age: number;

  @Column({ type: 'varchar' })
  gender: string;

  @Column({ type: 'varchar' })
  dob: string;

  @Column({ type: 'varchar' })
  phone: string;

  @Column({ type: 'varchar' })
  bloodType: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  allergies: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  currentMedications: string[];

  @Column({ type: 'jsonb', default: () => `'[]'` })
  conditions: string[];

  @Column({ type: 'varchar', nullable: true })
  chiefComplaint: string | null;

  @Index()
  @Column({ type: 'varchar', default: 'WAITING' })
  consultationStatus: ConsultationStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  registeredAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consultedAt: Date | null;

  /** Set once a "waiting too long" alert has been broadcast, so it is not repeated. */
  @Column({ type: 'timestamptz', nullable: true })
  waitAlertedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  fhirSynced: boolean;

  /** Session closed (discharged/administratively closed). Closed patients accept no new clinical writes until reopened. */
  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  closedBy: string | null;

  @Column({ type: 'varchar', nullable: true })
  closeReason: string | null;
}
