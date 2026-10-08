import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** One conversation with the agent. Owned by exactly one user. */
@Entity('chat_threads')
export class ChatThreadEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  userId: string;

  @Column({ type: 'varchar' })
  title: string;

  /** Rolling summary of the turns that no longer fit the context window. Contains real names (it is clinical data at rest). */
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  /** How many messages (from the start) the summary already covers. */
  @Column({ type: 'int', default: 0 })
  summarizedCount: number;

  /** Patient the conversation is currently about (id only); injected into the agent's context. */
  @Column({ type: 'varchar', nullable: true })
  activePatientId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
