import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

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

  /** true when `dob` was derived from the age (Jan 1 of the birth year) because no real date of birth was given. */
  @Column({ type: 'boolean', default: true })
  dobApproximate: boolean;

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

  @CreateDateColumn({ type: 'timestamptz' })
  registeredAt: Date;

  @Column({ type: 'boolean', default: false })
  fhirSynced: boolean;
}
