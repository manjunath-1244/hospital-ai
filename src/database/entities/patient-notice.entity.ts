import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type PatientNoticeChannel = 'SMS' | 'EMAIL' | 'STUB';
export type PatientNoticeStatus = 'SENT' | 'DELIVERED' | 'FAILED';

@Entity('patient_notices')
export class PatientNoticeEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  @Index('idx_pn_patient_id')
  patientId!: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  visitId?: string | null;

  @Column({ type: 'varchar', length: 16, default: 'STUB' })
  channel!: PatientNoticeChannel;

  @Column({ type: 'varchar', length: 128, nullable: true })
  recipientContact?: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 16, default: 'SENT' })
  status!: PatientNoticeStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
