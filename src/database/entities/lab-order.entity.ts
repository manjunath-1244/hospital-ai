import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type LabOrderStatus = 'ORDERED' | 'COLLECTED' | 'RESULTED' | 'CANCELLED';

@Entity('lab_orders')
export class LabOrderEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_lo_visit_id')
  visitId!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_lo_patient_id')
  patientId!: string;

  @Column({ type: 'varchar', length: 128 })
  testName!: string;

  @Column({ type: 'varchar', length: 64 })
  orderedById!: string;

  @Column({ type: 'varchar', length: 128 })
  orderedByName!: string;

  @Column({ type: 'varchar', length: 24, default: 'ORDERED' })
  status!: LabOrderStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  resultId?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
