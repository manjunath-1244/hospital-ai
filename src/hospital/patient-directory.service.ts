import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { VisitEntity } from '../database/entities/visit.entity';
import {
  ACTIVE_STATUSES,
  FINAL_STATUSES,
  VisitStatus,
  WAITING_STATUSES,
} from './visits/visit-status';
import { VisitSummary, toVisitSummary } from './visits/visit-summary';

/** Which patients to list, by where their latest visit stands. */
export type PatientStage =
  'ALL' | 'ACTIVE' | 'WAITING' | 'FINISHED' | 'NO_VISIT';

export interface DirectoryQuery {
  q?: string;
  /** Exact patient ids. */
  ids?: string[];
  stage?: PatientStage;
  /** Exact statuses of the latest visit (combined with `stage` by AND). */
  statuses?: VisitStatus[];
  limit?: number;
  offset?: number;
}

export interface PatientListItem {
  id: string;
  name: string;
  age: number;
  gender: string;
  dob: string;
  dobApproximate: boolean;
  phone: string;
  bloodType: string;
  allergies: string[];
  currentMedications: string[];
  conditions: string[];
  registeredAt: Date;
  fhirSynced: boolean;
  /** The patient's open visit, or if none the most recent finished one; null if they never had a visit. */
  visit: VisitSummary | null;
}

/**
 * Patient lists with each patient's latest visit attached, in ONE query (no N+1). Used by the patient screens, the
 * waiting queue and the agent's `searchPatients` tool, so they can never disagree about "who is where".
 */
@Injectable()
export class PatientDirectoryService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    query: DirectoryQuery = {},
  ): Promise<{ items: PatientListItem[]; total: number }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const params: unknown[] = [[...ACTIVE_STATUSES]];
    const where: string[] = [];

    const q = query.q?.trim();
    if (q) {
      params.push(`%${q}%`);
      where.push(
        `(p."name" ILIKE $${params.length} OR p."id" ILIKE $${params.length})`,
      );
    }
    if (query.ids?.length) {
      params.push(query.ids.map((i) => i.toUpperCase()));
      where.push(`p."id" = ANY($${params.length}::text[])`);
    }
    const stage = query.stage ?? 'ALL';
    const stageStatuses: Partial<Record<PatientStage, readonly VisitStatus[]>> =
      {
        ACTIVE: ACTIVE_STATUSES,
        WAITING: WAITING_STATUSES,
        FINISHED: FINAL_STATUSES,
      };
    if (stage === 'NO_VISIT') where.push('lv."id" IS NULL');
    else if (stageStatuses[stage]) {
      params.push([...stageStatuses[stage]]);
      where.push(`lv."status" = ANY($${params.length}::text[])`);
    }
    if (query.statuses?.length) {
      params.push(query.statuses);
      where.push(`lv."status" = ANY($${params.length}::text[])`);
    }

    // latest visit = the open one if there is one, otherwise the most recent finished one
    const from = `
      FROM "patients" p
      LEFT JOIN LATERAL (
        SELECT v.* FROM "visits" v WHERE v."patientId" = p."id"
        ORDER BY (v."status" = ANY($1::text[])) DESC, v."arrivedAt" DESC LIMIT 1
      ) lv ON true
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;

    const total = Number(
      (
        await this.dataSource.query(`SELECT count(*)::int AS n ${from}`, params)
      )[0].n,
    );
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT p.*, to_jsonb(lv) AS "visit" ${from}
       ORDER BY COALESCE(lv."arrivedAt", p."registeredAt") DESC, p."id"
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return { items: rows.map((r) => this.toItem(r)), total };
  }

  /** The same item shape for one patient id (or null). */
  async getOne(patientId: string): Promise<PatientListItem | null> {
    const { items } = await this.list({ ids: [patientId], limit: 1 });
    return items[0] ?? null;
  }

  private toItem(r: Record<string, any>): PatientListItem {
    const { visit, ...p } = r;
    return {
      id: p.id,
      name: p.name,
      age: p.age,
      gender: p.gender,
      dob: p.dob,
      dobApproximate: p.dobApproximate,
      phone: p.phone,
      bloodType: p.bloodType,
      allergies: p.allergies,
      currentMedications: p.currentMedications,
      conditions: p.conditions,
      registeredAt: p.registeredAt,
      fhirSynced: p.fhirSynced,
      visit: visit ? toVisitSummary(this.reviveDates(visit)) : null,
    };
  }

  /** `to_jsonb` returns timestamps as strings; the summary builder expects Dates. */
  private reviveDates(v: Record<string, any>): VisitEntity {
    const date = (x: string | null) => (x ? new Date(x) : null);
    return {
      ...v,
      arrivedAt: new Date(v.arrivedAt),
      triagedAt: date(v.triagedAt),
      consultationStartedAt: date(v.consultationStartedAt),
      completedAt: date(v.completedAt),
      waitAlertedAt: date(v.waitAlertedAt),
      updatedAt: new Date(v.updatedAt),
    } as VisitEntity;
  }
}
