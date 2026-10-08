import { Entity, PrimaryColumn, Column } from 'typeorm';
import type { UserRole } from '../../security/roles.decorator';

@Entity('users')
export class UserEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar', unique: true })
  username: string;

  @Column({ type: 'varchar' })
  passwordHash: string;

  @Column({ type: 'varchar' })
  displayName: string;

  @Column({ type: 'varchar' })
  role: UserRole;

  /** Clinical specialty of a SPECIALIST (e.g. Cardiology); null for other staff. */
  @Column({ type: 'varchar', nullable: true })
  specialty: string | null;

  @Column({ type: 'varchar', nullable: true })
  department: string | null;

  /** Switch off to stop new referrals and bookings (leave, sick day) without deleting the account. */
  @Column({ type: 'boolean', default: true })
  isAvailable: boolean;
}
