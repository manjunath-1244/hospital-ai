import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' }) userId: string;
  @Column({ type: 'varchar' }) role: string;
  @Column({ type: 'varchar' }) method: string;
  @Column({ type: 'varchar' }) path: string;
  @Index()
  @Column({ type: 'varchar', nullable: true })
  patientId: string | null;
  @Column({ type: 'int' }) statusCode: number;

  @CreateDateColumn({ type: 'timestamptz' })
  at: Date;
}
