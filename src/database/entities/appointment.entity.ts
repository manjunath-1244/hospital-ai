import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

@Entity('appointments')
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
