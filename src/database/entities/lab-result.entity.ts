import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('lab_results')
export class LabResultEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  patientId: string;

  /** The visit this record belongs to (null only for data created before visits existed). */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  visitId: string | null;

  @Column({ type: 'varchar' })
  testName: string;

  @Column({ type: 'varchar' })
  value: string;

  @Column({ type: 'varchar' })
  unit: string;

  @Column({ type: 'varchar' })
  referenceRange: string;

  @Column({ type: 'varchar' })
  status: string;

  @Column({ type: 'varchar' })
  date: string;

  @Column({ type: 'varchar', nullable: true })
  recordedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
