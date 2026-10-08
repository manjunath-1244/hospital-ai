import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import type { VisitStatus } from '../../hospital/visits/visit-status';

/** The timeline of a visit: every status change, who made it and why. Append-only by convention. */
@Entity('visit_events')
export class VisitEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  visitId: string;

  /** null for the creation event. */
  @Column({ type: 'varchar', nullable: true })
  fromStatus: VisitStatus | null;

  @Column({ type: 'varchar' })
  toStatus: VisitStatus;

  @Column({ type: 'varchar' })
  actorId: string;

  @Column({ type: 'varchar' })
  actorName: string;

  @Column({ type: 'varchar' })
  actorRole: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  at: Date;
}
