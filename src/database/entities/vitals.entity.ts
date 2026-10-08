import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('vitals')
export class VitalsEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  patientId: string;

  @Column({ type: 'int' }) heartRate: number;
  @Column({ type: 'int' }) bpSystolic: number;
  @Column({ type: 'int' }) spO2: number;
  @Column({ type: 'float' }) tempCelsius: number;
  @Column({ type: 'int' }) respiratoryRate: number;
  @Column({ type: 'int', nullable: true }) painScore: number | null;
  @Column({ type: 'varchar' }) consciousness: string;
  @Column({ type: 'boolean' }) onSupplementalO2: boolean;
  @Column({ type: 'int' }) news2Score: number;
  @Column({ type: 'varchar' }) riskLevel: string;
  @Column({ type: 'varchar' }) recordedBy: string;

  @CreateDateColumn({ type: 'timestamptz' })
  recordedAt: Date;
}
