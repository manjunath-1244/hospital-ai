import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('imaging_studies')
export class ImagingStudyEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  patientId: string;

  /** The visit this record belongs to (null only for data created before visits existed). */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  visitId: string | null;

  @Column({ type: 'varchar' }) studyInstanceUid: string;
  @Column({ type: 'varchar', nullable: true }) seriesInstanceUid: string | null;
  @Column({ type: 'varchar' }) modality: string;
  @Column({ type: 'varchar', nullable: true }) description: string | null;
  @Column({ type: 'text', nullable: true }) impression: string | null;
  @Column({ type: 'int', nullable: true }) rows: number | null;
  @Column({ type: 'int', nullable: true }) columns: number | null;
  @Column({ type: 'varchar', nullable: true }) studyDate: string | null;
  /** Orthanc instance id (used to fetch the rendered preview). Null when PACS storage failed. */
  @Column({ type: 'varchar', nullable: true }) orthancInstanceId: string | null;
  @Column({ type: 'varchar', nullable: true }) fhirId: string | null;
  @Column({ type: 'varchar' }) uploadedBy: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
