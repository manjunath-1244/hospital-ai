import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('consultations')
export class ConsultationEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  patientId: string;

  @Column({ type: 'varchar' })
  doctorId: string;

  @Column({ type: 'varchar' })
  doctorName: string;

  @Column({ type: 'text' })
  diagnosis: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  prescriptions: string[];

  @Column({ type: 'text' })
  notes: string;

  @Column({ type: 'jsonb', nullable: true })
  safety: unknown;

  @Column({ type: 'text', nullable: true })
  overrideReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
