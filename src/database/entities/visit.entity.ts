import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ACTIVE_STATUSES } from '../../hospital/visits/visit-status';
import type {
  VisitOutcome,
  VisitStatus,
} from '../../hospital/visits/visit-status';

const activeList = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ');

/**
 * One episode of care (arrival → … → completed). A patient (person) can have many visits over time; clinical records
 * (vitals, labs, imaging, consultations, appointments, tasks) belong to the visit they were created in.
 * The status is changed ONLY through `VisitsService.transition()`.
 */
@Entity('visits')
// A patient can have at most one open visit; enforced by the database, not just by application code.
@Index('uq_visit_one_open_per_patient', ['patientId'], {
  unique: true,
  where: `"status" IN (${activeList})`,
})
export class VisitEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  patientId: string;

  @Index()
  @Column({ type: 'varchar' })
  status: VisitStatus;

  @Column({ type: 'varchar', nullable: true })
  chiefComplaint: string | null;

  /** Urgency 1 (most urgent) – 5. Suggested by the triage calculator, assigned by the nurse. */
  @Column({ type: 'int', nullable: true })
  priority: number | null;

  @Column({ type: 'varchar', nullable: true })
  department: string | null;

  @Column({ type: 'varchar', nullable: true })
  primaryDoctorId: string | null;

  @Column({ type: 'varchar', nullable: true })
  primaryDoctorName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  arrivedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  triagedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  consultationStartedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** Set once a "waiting too long" alert has been broadcast for this visit, so it is not repeated. */
  @Column({ type: 'timestamptz', nullable: true })
  waitAlertedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  outcome: VisitOutcome | null;

  /** Why the visit was cancelled / closed / reopened (free text from the actor). */
  @Column({ type: 'text', nullable: true })
  closeReason: string | null;

  @Column({ type: 'varchar' })
  createdBy: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
