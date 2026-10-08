import { Injectable } from '@nestjs/common';
import { HospitalService } from '../../hospital/hospital.service';
import { ClinicalToolsFactory } from '../tools/clinical-tools.factory';
import { PhiAnonymizerService } from '../security/phi-anonymizer.service';
import { Intent } from '../routing/intent';
import {
  detectSections,
  isPureLookup,
  REFERS_BACK,
} from '../routing/chart-view';
import { extractPatientIds } from '../routing/intent';
import { AuthUser } from '../../security/auth-user';
import { RunRecorder } from '../observability/run-recorder';

export interface GatheredContext {
  text: string | null;
  sources: number;
  notFound: string[];
  onlyNotFound: boolean;
  charts: Map<string, any>;
  needsPatient: boolean;
  subjectIds: string[];
  /** Rules-based referral review of the single patient the question is about (only when asked for). */
  referral?: { patientId: string; result: any } | null;
}

@Injectable()
export class AiContextService {
  constructor(
    private readonly hospital: HospitalService,
    private readonly tools: ClinicalToolsFactory,
  ) {}

  async gatherContext(
    user: AuthUser,
    message: string,
    intent: Intent,
    session: Awaited<ReturnType<PhiAnonymizerService['createSession']>>,
    rec: RunRecorder,
    activePatientId: string | null,
  ): Promise<GatheredContext> {
    const parts: Array<{ source: string; data: unknown }> = [];
    const ctx = { user, trace: rec.trace };
    const mentioned = await this.hospital.findMentioned(message);
    const charts = new Map<string, any>();

    const otherIntent =
      intent.list ||
      intent.overview ||
      intent.policy ||
      intent.waiting ||
      intent.crossSearch;

    const refersBack =
      REFERS_BACK.test(message) ||
      ((isPureLookup(message) || detectSections(message).length > 0) &&
        !otherIntent);

    const subjectIds = mentioned.map((p) => p.id);
    if (!subjectIds.length && refersBack && activePatientId)
      subjectIds.push(activePatientId);

    const hasExplicitPatientId = extractPatientIds(message).length > 0;
    const isSectionLookup =
      isPureLookup(message) && detectSections(message).length > 0;

    const needsPatient =
      !subjectIds.length &&
      !hasExplicitPatientId &&
      !otherIntent &&
      !intent.write &&
      !intent.medication &&
      !intent.triage &&
      (REFERS_BACK.test(message) || isSectionLookup);

    if (needsPatient) {
      return {
        text: null,
        sources: 0,
        notFound: [],
        onlyNotFound: false,
        charts,
        needsPatient: true,
        subjectIds: [],
      };
    }

    for (const id of subjectIds) {
      const chart = await this.tools.runDirect(
        'getPatientSummary',
        { patientId: id },
        ctx,
      );
      if (chart) {
        charts.set(id, chart);
        parts.push({ source: `patient chart ${id}`, data: chart });
      }
    }

    let referral: GatheredContext['referral'] = null;
    if (intent.review && subjectIds.length === 1) {
      const r = await this.tools.runDirect(
        'reviewReferralNeed',
        { patientId: subjectIds[0] },
        ctx,
      );
      if (r) {
        referral = { patientId: subjectIds[0], result: r };
        parts.push({ source: `referral review of ${subjectIds[0]}`, data: r });
      }
    }

    if (intent.list) {
      const r = await this.tools.runDirect(
        'searchPatients',
        { stage: 'ALL', limit: 100 },
        ctx,
      );
      if (r) parts.push({ source: 'all patients', data: r });
    } else if (intent.waiting) {
      const r = await this.tools.runDirect(
        'searchPatients',
        { stage: 'WAITING', limit: 100 },
        ctx,
      );
      if (r) parts.push({ source: 'patients waiting for a doctor', data: r });
    }

    if (intent.overview || intent.waiting) {
      const r = await this.tools.runDirect('getHospitalOverview', {}, ctx);
      if (r) parts.push({ source: 'hospital overview', data: r });
    }

    if (intent.policy) {
      const r = await this.tools.runDirect(
        'searchHospitalPolicies',
        { query: message, topK: 4 },
        ctx,
      );
      if (r) parts.push({ source: 'hospital policies and documents', data: r });
    }

    if (intent.crossSearch && !mentioned.length) {
      const r = await this.tools.runDirect(
        'searchClinicalRecords',
        { query: message, topK: 6 },
        ctx,
      );
      if (r) parts.push({ source: 'clinical record search results', data: r });
    }

    const known = new Set(subjectIds);
    const unknown = extractPatientIds(message).filter((id) => !known.has(id));
    const notFound: string[] = [];
    for (const id of unknown) {
      try {
        await this.hospital.getPatientById(id);
      } catch {
        notFound.push(id);
        parts.push({
          source: `lookup of ${id}`,
          data: {
            found: false,
            message: `No patient with id ${id} exists in the system.`,
          },
        });
      }
    }

    if (!parts.length && !intent.write && !intent.triage) {
      await this.tools
        .runDirect(
          'searchHospitalPolicies',
          { query: message, topK: 4, minScore: 0.6 },
          ctx,
          (o) => (o?.matches?.length ?? 0) > 0,
        )
        .then((r) => {
          if (r?.matches?.length)
            parts.push({ source: 'hospital policies and documents', data: r });
        });
    }

    if (!parts.length)
      return {
        text: null,
        sources: 0,
        notFound,
        onlyNotFound: false,
        charts,
        needsPatient: false,
        subjectIds,
      };

    const body = parts
      .map(
        (p) => `### ${p.source}\n${JSON.stringify(session.maskDeep(p.data))}`,
      )
      .join('\n\n');

    return {
      text: `CONTEXT (retrieved by the system just now; authoritative and complete for this user's role):\n${body}`,
      sources: parts.length,
      notFound,
      onlyNotFound: notFound.length > 0 && parts.length === notFound.length,
      charts,
      needsPatient: false,
      subjectIds,
      referral,
    };
  }
}
