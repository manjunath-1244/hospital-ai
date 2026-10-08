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
