import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

@Entity('appointments')
// Same guarantee per doctor ACCOUNT (the name is only for display and for legacy rows without an id).
@Index('uq_appointment_doctorid_slot', ['doctorId', 'dateTime'], {
  unique: true,
  where: `"status" = 'SCHEDULED' AND "doctorId" IS NOT NULL`,
})
// A doctor can have at most one SCHEDULED appointment per slot (enforced by the database, not only by app code).
@Index('uq_appointment_doctor_slot', ['doctorName', 'dateTime'], {
  unique: true,
  where: `"status" = 'SCHEDULED'`,
})
export class AppointmentEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  patientId: string;

  /** The visit this record belongs to (null only for data created before visits existed). */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  visitId: string | null;

  /** The doctor's user id when booked against a real account (null for free-text legacy bookings). */
  @Column({ type: 'varchar', nullable: true })
  doctorId: string | null;

  @Column({ type: 'varchar' })
  doctorName: string;

  @Column({ type: 'varchar' })
  department: string;

  @Column({ type: 'varchar' })
  dateTime: string;

  @Column({ type: 'varchar' })
  status: string;

  @Column({ type: 'varchar' })
  reason: string;
}
