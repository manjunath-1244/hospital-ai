import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FollowUpPlanStatus =
  'DRAFT' | 'PROPOSED' | 'APPROVED' | 'COMPLETED';

export interface FollowUpPlanItem {
  type: 'APPOINTMENT' | 'LAB_ORDER' | 'TASK' | 'PATIENT_NOTICE';
  summary: string;
  details: any;
}

@Entity('follow_up_plans')
export class FollowUpPlanEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_fup_visit_id')
  visitId!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_fup_patient_id')
  patientId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  createdFromRequestId?: string | null;

  @Column({ type: 'jsonb' })
  items!: FollowUpPlanItem[];

  @Column({ type: 'varchar', length: 24, default: 'DRAFT' })
  status!: FollowUpPlanStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
