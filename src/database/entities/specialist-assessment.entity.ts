import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('specialist_assessments')
export class SpecialistAssessmentEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_sa_request_id')
  requestId!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_sa_visit_id')
  visitId!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_sa_patient_id')
  patientId!: string;

  @Column({ type: 'varchar', length: 64 })
  authorId!: string;

  @Column({ type: 'varchar', length: 128 })
  authorName!: string;

  @Column({ type: 'varchar', length: 64 })
  specialty!: string;

  @Column({ type: 'text' })
  assessment!: string;

  @Column({ type: 'text' })
  recommendation!: string;

  @Column({ type: 'text' })
  treatment!: string;

  @Column({ type: 'text' })
  followUp!: string;

  @CreateDateColumn()
  completedAt!: Date;
}
