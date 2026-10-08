import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/** One weekly working window of a doctor (see `hospital/specialists/availability.ts`). Times are UTC. */
@Entity('doctor_availability')
export class DoctorAvailabilityEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  doctorId: string;

  /** 0 = Sunday … 6 = Saturday. */
  @Column({ type: 'int' })
  weekday: number;

  @Column({ type: 'varchar', length: 5 })
  startTime: string;

  @Column({ type: 'varchar', length: 5 })
  endTime: string;

  @Column({ type: 'int', default: 30 })
  slotMinutes: number;
}
