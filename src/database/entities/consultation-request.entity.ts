import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ReferralStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export type ReferralUrgency = 'ROUTINE' | 'URGENT' | 'EMERGENCY';

@Entity('consultation_requests')
export class ConsultationRequestEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_cr_visit_id')
  visitId!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_cr_patient_id')
  patientId!: string;

  @Column({ type: 'varchar', length: 64 })
  requestedById!: string;

  @Column({ type: 'varchar', length: 128 })
  requestedByName!: string;

  @Column({ type: 'varchar', length: 64 })
  @Index('idx_cr_specialty')
  specialty!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index('idx_cr_assigned_specialist')
  assignedSpecialistId?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  assignedSpecialistName?: string | null;

  @Column({ type: 'varchar', length: 16, default: 'ROUTINE' })
  urgency!: ReferralUrgency;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'text', nullable: true })
  aiRationale?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  evidence?: any;

  @Column({ type: 'varchar', length: 24, default: 'REQUESTED' })
  @Index('idx_cr_status')
  status!: ReferralStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  cancellationReason?: string | null;
}
