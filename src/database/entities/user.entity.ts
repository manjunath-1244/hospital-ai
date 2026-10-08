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
}
