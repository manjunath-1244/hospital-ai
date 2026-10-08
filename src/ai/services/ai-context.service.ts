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
  /** The user's spelling was corrected to a patient (shown to the user, never silent). */
  corrected?: { typed: string; patientId: string; name: string } | null;
  /** Several patients are equally close to what was typed: ask, do not guess. */
  didYouMean?: Array<{ typed: string; patientId: string; name: string }>;
  /** A lookup named someone who is not in the system (answered directly, no model). */
  unknownName?: string | null;
  /** Output of findSpecialists when the question is about the specialists themselves. */
  specialists?: any | null;
  /** Output of getStaffSummary when the question is about staff counts/names. */
  staff?: any | null;
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

    // Nothing matched exactly: a typing mistake in a name ("James Mllelr") is corrected, or the user is asked.
    let corrected: GatheredContext['corrected'] = null;
    let didYouMean: GatheredContext['didYouMean'] = [];
    if (
      !mentioned.length &&
      !extractPatientIds(message).length &&
      !otherIntent &&
      !intent.triage
    ) {
      const fuzzy = await this.hospital.findFuzzy(message);
      const found = fuzzy.map((f) => ({
        typed: f.typed,
        patientId: f.patient.id,
        name: f.patient.name,
      }));
      if (found.length === 1) {
        corrected = found[0];
        subjectIds.push(found[0].patientId);
      } else didYouMean = found.slice(0, 4);
    }
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

    // "details about Jon Smith" and nobody (not even approximately) is called that: say so, do not let a model improvise.
    const named = message.match(
      /\b(?:about|for|of|on|regarding)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\s*[?.!]*$/,
    );
    if (
      !subjectIds.length &&
      !didYouMean.length &&
      !otherIntent &&
      !intent.write &&
      !intent.medication &&
      !intent.triage &&
      !intent.review &&
      !REFERS_BACK.test(message) &&
      !extractPatientIds(message).length &&
      isPureLookup(message) &&
      named &&
      !/^(the|a|an|this|that|my|our|patient|patients|him|her|them|it)$/i.test(
        named[1].trim(),
      )
    ) {
      return {
        text: null,
        sources: 0,
        notFound: [],
        onlyNotFound: false,
        charts,
        needsPatient: false,
        subjectIds: [],
        unknownName: named[1].trim(),
      };
    }

    if (didYouMean.length) {
      return {
        text: null,
        sources: 0,
        notFound: [],
        onlyNotFound: false,
        charts,
        needsPatient: false,
        subjectIds: [],
        didYouMean,
      };
    }

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

    if (corrected)
      parts.push({
        source: 'name correction',
        data: {
          note: `The user typed "${corrected.typed}"; the system understood this as ${corrected.name} (${corrected.patientId}). Mention this correction in the answer.`,
        },
      });
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

    let staff: any = null;
    if (intent.staff) {
      staff = await this.tools.runDirect('getStaffSummary', {}, ctx);
      if (staff) parts.push({ source: 'staff accounts', data: staff });
    }

    let specialists: any = null;
    if (intent.specialists) {
      const all = await this.tools.runDirect('findSpecialists', {}, ctx);
      if (all) {
        // a named specialty ("cardiologists", "neurology") narrows the list; the specialty names come from the data
        const words: string[] = message.toLowerCase().match(/[a-z]{5,}/g) ?? [];
        const wanted = (all.specialties as string[]).find((sp) =>
          words.some(
            (w) => w.length >= 5 && sp.toLowerCase().startsWith(w.slice(0, 5)),
          ),
        );
        specialists = wanted
          ? {
              ...all,
              specialists: all.specialists.filter(
                (s: any) => s.specialty === wanted,
              ),
              specialty: wanted,
            }
          : all;
        parts.push({ source: 'specialists', data: specialists });
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
      corrected,
      specialists,
      staff,
    };
  }
}
