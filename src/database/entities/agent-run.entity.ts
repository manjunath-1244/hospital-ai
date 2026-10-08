import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export interface RunStep {
  type: 'llm' | 'tool' | 'memory';
  name: string;
  startOffsetMs: number;
  durationMs: number;
  success: boolean;
  error?: string;
  /** PHI-masked tool arguments. */
  args?: unknown;
}

/** One agent execution = one trace. Source for observability, metrics and drift detection. */
@Entity('agent_runs')
export class AgentRunEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string; // trace id

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  at: Date;

  @Column({ type: 'varchar' }) kind: 'chat' | 'document';
  @Column({ type: 'varchar' }) userId: string;
  @Column({ type: 'varchar' }) userRole: string;
  @Column({ type: 'varchar', nullable: true }) threadId: string | null;
  @Column({ type: 'varchar' }) model: string;
  @Column({ type: 'varchar' }) status: 'OK' | 'ERROR';
  @Column({ type: 'int' }) durationMs: number;
  @Column({ type: 'varchar', nullable: true }) guardrailStatus: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) guardrailNotes: string[];
  @Column({ type: 'int', default: 0 }) retries: number;
  @Column({ type: 'text', nullable: true }) error: string | null;
  @Column({ type: 'jsonb', nullable: true }) usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } | null;
  @Column({ type: 'jsonb', default: () => `'[]'` }) steps: RunStep[];
  @Column({ type: 'int', default: 0 }) toolCallCount: number;
  @Column({ type: 'int', default: 0 }) toolFailureCount: number;
  @Column({ type: 'jsonb', default: () => `'[]'` }) toolNames: string[];
}
