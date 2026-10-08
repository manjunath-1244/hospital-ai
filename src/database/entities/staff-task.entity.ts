import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('staff_tasks')
export class StaffTaskEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  /** The visit this record belongs to (null only for data created before visits existed). */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  visitId: string | null;

  @Column({ type: 'varchar' })
  assignedTo: string;

  @Column({ type: 'varchar', nullable: true })
  patientId: string | null;

  @Column({ type: 'varchar' })
  priority: string;

  @Column({ type: 'varchar' })
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
