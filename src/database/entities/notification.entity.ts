import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type NotificationChannel = 'IN_APP' | 'PATIENT_NOTICE';

@Entity('notifications')
export class NotificationEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index('idx_notif_recipient_user')
  recipientUserId?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  @Index('idx_notif_recipient_patient')
  recipientPatientId?: string | null;

  @Column({ type: 'varchar', length: 64 })
  type!: string;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', nullable: true })
  payload?: any;

  @Column({ type: 'varchar', length: 24, default: 'IN_APP' })
  channel!: NotificationChannel;

  @Column({ type: 'timestamp', nullable: true })
  readAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceActionId?: string | null;

  @CreateDateColumn()
  @Index('idx_notif_created_at')
  createdAt!: Date;
}
