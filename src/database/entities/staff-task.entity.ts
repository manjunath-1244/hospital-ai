import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('staff_tasks')
export class StaffTaskEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  title: string;

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
