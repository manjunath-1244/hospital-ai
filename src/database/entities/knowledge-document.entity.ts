import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/** A hospital document (policy, SOP, protocol) uploaded by an admin. Indexed into the vector store for the agent. */
@Entity('knowledge_documents')
export class KnowledgeDocumentEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'varchar' })
  filename: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'int' })
  sizeBytes: number;

  @Column({ type: 'varchar' })
  uploadedBy: string;

  /** Key under which its chunks live in the vector store (also what the agent cites). */
  @Column({ type: 'varchar' })
  ragSource: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
