import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ActionTier = 'AUTO' | 'ASK' | 'ASK_HUMAN' | 'NEVER';
export type ActionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'EXECUTING'
  | 'DONE'
  | 'FAILED';

@Entity('agent_actions')
@Index(['proposedByUserId', 'status'])
@Index(['patientId', 'status'])
export class AgentActionEntity {
  @PrimaryColumn()
  id!: string; // ACT + 8 unambiguous chars

  @Column({ nullable: true })
  threadId?: string;

  @Column({ nullable: true })
  traceId?: string;

  @Column()
  proposedByUserId!: string;

  @Column()
  proposedByRole!: string;

  @Column({ nullable: true })
  patientId?: string;

  @Column({ nullable: true })
  visitId?: string;

  @Column()
  type!: string; // REFERRAL | APPOINTMENT | REGISTER_PATIENT | STAFF_TASK | CONSULTATION | LAB_ORDER | NOTIFICATION | FOLLOW_UP | CLOSE_VISIT | REOPEN_VISIT

  @Column({ type: 'varchar', default: 'ASK' })
  tier!: ActionTier;

  @Column({ type: 'jsonb' })
  payload!: Record<string, any>;

  @Column()
  summary!: string; // Deterministic summary, never LLM text

  @Column({ type: 'varchar', default: 'PENDING' })
  status!: ActionStatus;

  @Column({ type: 'timestamp with time zone' })
  expiresAt!: Date;

  @Column({ nullable: true })
  decidedByUserId?: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  decidedAt?: Date;

  @Column({ nullable: true })
  decisionNote?: string;

  @Column({ type: 'jsonb', nullable: true })
  result?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  verification?: {
    verified: boolean;
    checks: string[];
    error?: string;
  };

  @Column({ unique: true })
  idempotencyKey!: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt!: Date;
}
