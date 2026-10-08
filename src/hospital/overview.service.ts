import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatientEntity } from '../database/entities/patient.entity';
import { VisitEntity } from '../database/entities/visit.entity';
import { LabResultEntity } from '../database/entities/lab-result.entity';
import { StaffTaskEntity } from '../database/entities/staff-task.entity';
import { AppointmentEntity } from '../database/entities/appointment.entity';
import {
  ACTIVE_STATUSES,
  VISIT_STATUSES,
  VisitStatus,
  WAITING_STATUSES,
} from './visits/visit-status';

export interface HospitalOverview {
  totalPatients: number;
  /** Visits by status (every status is present, zero if none). */
  visitsByStatus: Record<VisitStatus, number>;
  activeVisits: number;
  waitingForTriage: number;
  waitingForDoctor: number;
  /** Open visits that are with the doctor or beyond (consultation, review, treatment, follow-up). */
  withDoctor: number;
  completedToday: number;
  longestWaitMinutes: number;
  criticalLabsLast24h: number;
  pendingStaffTasks: number;
  scheduledAppointments: number;
}

/** Headline numbers for dashboards and the agent. Composed here so no single service needs to know every table. */
@Injectable()
export class OverviewService {
  constructor(
    @InjectRepository(PatientEntity)
    private readonly patients: Repository<PatientEntity>,
    @InjectRepository(VisitEntity)
    private readonly visits: Repository<VisitEntity>,
    @InjectRepository(LabResultEntity)
    private readonly labs: Repository<LabResultEntity>,
    @InjectRepository(StaffTaskEntity)
    private readonly tasks: Repository<StaffTaskEntity>,
    @InjectRepository(AppointmentEntity)
    private readonly appointments: Repository<AppointmentEntity>,
  ) {}

  async get(now: Date = new Date()): Promise<HospitalOverview> {
    const rows: { status: VisitStatus; n: string }[] = await this.visits
      .createQueryBuilder('v')
      .select('v.status', 'status')
      .addSelect('count(*)', 'n')
      .groupBy('v.status')
      .getRawMany();
    const visitsByStatus = Object.fromEntries(
      VISIT_STATUSES.map((s) => [s, 0]),
    ) as Record<VisitStatus, number>;
    rows.forEach((r) => (visitsByStatus[r.status] = Number(r.n)));
    const sum = (list: readonly VisitStatus[]) =>
      list.reduce((a, s) => a + visitsByStatus[s], 0);

    const oldestWaiting = await this.visits
      .createQueryBuilder('v')
      .where('v.status IN (:...w)', { w: [...WAITING_STATUSES] })
      .orderBy('v."arrivedAt"', 'ASC')
      .getOne();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    return {
      totalPatients: await this.patients.count(),
      visitsByStatus,
      activeVisits: sum(ACTIVE_STATUSES),
      waitingForTriage: visitsByStatus.WAITING_TRIAGE,
      waitingForDoctor: visitsByStatus.TRIAGED,
      withDoctor: sum([
        'IN_CONSULTATION',
        'UNDER_REVIEW',
        'TREATMENT',
        'FOLLOW_UP',
      ]),
      completedToday: await this.visits
        .createQueryBuilder('v')
        .where(`v.status = 'COMPLETED'`)
        .andWhere('v."completedAt" >= :d', { d: startOfDay })
        .getCount(),
      longestWaitMinutes: oldestWaiting
        ? Math.floor(
            (now.getTime() - oldestWaiting.arrivedAt.getTime()) / 60_000,
          )
        : 0,
      criticalLabsLast24h: await this.labs
        .createQueryBuilder('l')
        .where('l.status = :s', { s: 'CRITICAL' })
        .andWhere('l."createdAt" > :d', {
          d: new Date(now.getTime() - 24 * 3_600_000),
        })
        .getCount(),
      pendingStaffTasks: await this.tasks.count({
        where: { status: 'PENDING' },
      }),
      scheduledAppointments: await this.appointments.count({
        where: { status: 'SCHEDULED' },
      }),
    };
  }
}
