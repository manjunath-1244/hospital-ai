import { fenceData, FENCE_NOTICE } from '../data-fence';
import { Injectable } from '@nestjs/common';
import {
  resolvePeople,
  type Person,
  type PersonMatch,
} from '../../hospital/person-resolution';
import { SpecialistService } from '../../hospital/specialists/specialist.service';
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
  /** The question asked for a specialist-need review but this role may not run one (answered with a refusal, no model). */
  reviewDenied?: boolean;
  /** Tools whose result was withheld from this user (role or referral rule). Answered with a refusal, never by the model. */
  denied?: string[];
  /** The user's spelling was corrected to a patient (shown to the user, never silent). */
  corrected?: {
    typed: string;
    patientId: string;
    name: string;
    kind?: string;
  } | null;
  /** Several patients are equally close to what was typed: ask, do not guess. */
  didYouMean?: Array<{
    typed: string;
    patientId: string;
    name: string;
    kind?: string;
  }>;
  /** A lookup named someone who is not in the system (answered directly, no model). */
  unknownName?: string | null;
  /** Output of findSpecialists when the question is about the specialists themselves. */
  specialists?: any | null;
  /** A staff member the question is about (their name was recognised). */
  staffPerson?: {
    typed: string;
    patientId: string;
    name: string;
    kind: string;
    exact: boolean;
  } | null;
  /** One-line description of that staff member (role, specialty, availability). */
  staffDetail?: string | null;
  /** Output of getStaffSummary when the question is about staff counts/names. */
  staff?: any | null;
}

@Injectable()
export class AiContextService {
  constructor(
    private readonly hospital: HospitalService,
    private readonly tools: ClinicalToolsFactory,
    private readonly specialistService: SpecialistService,
  ) {}

  /** Staff accounts as people the resolver can match (names are not patient data). */
  private async staffPeople(): Promise<Person[]> {
    const byRole = await this.specialistService.staffByRole();
    return Object.values(byRole)
      .flat()
      .map((s) => ({
        kind: 'STAFF' as const,
        id: s.id,
        name: `${s.name}${s.specialty ? ` (${s.specialty})` : ''}`,
      }));
  }

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
    const charts = new Map<string, any>();
    const denied: string[] = [];
    const direct = async (
      name: string,
      args: unknown,
      recordIf?: (o: any) => boolean,
    ) => {
      const r = await this.tools.runDirect(name, args, ctx, recordIf);
      // "refused" (role cannot use the tool; a specialist without a referral for this patient) is not "failed"
      if (
        r == null &&
        (!this.tools.toolAllowedFor(name, user.role) ||
          (user.role === 'SPECIALIST' && name === 'getPatientSummary'))
      )
        denied.push(name);
      return r;
    };
    const plan = intent.plan;

    // Which question shapes need a patient to be identified at all (a count or a policy question does not).
    const needsSubject =
      plan.intent === 'LOOKUP' ||
      plan.intent === 'CLINICAL_QUESTION' ||
      plan.intent === 'CLINICAL_REVIEW' ||
      plan.intent === 'ACTION';

    // ---- who is it about? ids are exact; names are resolved over patients AND staff in one pass --------------------
    let subjectIds: string[] = [];
    let corrected: GatheredContext['corrected'] = null;
    let didYouMean: NonNullable<GatheredContext['didYouMean']> = [];
    let staffPerson: GatheredContext['staffPerson'] = null;
    if (plan.patientRef.kind === 'ID') {
      subjectIds = (await this.hospital.findMentioned(message)).map(
        (p) => p.id,
      );
    } else if (!intent.triage) {
      const people = [
        ...(await this.hospital.allPatientBriefs()),
        ...(await this.staffPeople()),
      ];
      const found = resolvePeople(message, people);
      const label = (m: PersonMatch) => ({
        typed: m.typed.join(' '),
        patientId: m.person.id,
        name: m.person.name.replace(/\s*\([^)]*\)\s*$/, ''),
        kind: m.person.kind,
      });
      if (found.status === 'AMBIGUOUS') {
        didYouMean = found.matches.map(label);
      } else if (found.matches.length) {
        const patientHits = found.matches.filter(
          (m) => m.person.kind === 'PATIENT',
        );
        const staffHit = found.matches.find((m) => m.person.kind === 'STAFF');
        if (patientHits.length) {
          subjectIds = patientHits.map((m) => m.person.id).slice(0, 3);
          if (found.status === 'CORRECTED') corrected = label(patientHits[0]);
        } else if (staffHit) {
          staffPerson = { ...label(staffHit), exact: found.status === 'EXACT' };
        }
      }
    }
    // A staff member was named: show who they are (non-PHI) and, for specialists, when they are next free.
    let staffDetail: string | null = null;
    if (staffPerson) {
      const byRole = await this.specialistService.staffByRole();
      const role = Object.entries(byRole).find(([, list]) =>
        list.some((s) => s.id === staffPerson!.patientId),
      );
      const rec2 = role?.[1].find((s) => s.id === staffPerson!.patientId);
      const roleLabel =
        role?.[0]?.toLowerCase().replace(/_/g, ' ') ?? 'staff member';
      staffDetail = `${staffPerson.name} — ${roleLabel}${rec2?.specialty ? ` (${rec2.specialty})` : ''}`;
      if (rec2?.specialty) {
        const av = await this.tools.runDirect(
          'getSpecialistAvailability',
          { doctorId: staffPerson.patientId, limit: 3 },
          ctx,
        );
        staffDetail += rec2.isAvailable
          ? `; available for bookings${av?.nextFreeSlot ? `; next free slot ${av.nextFreeSlot}` : ''}`
          : '; currently not available';
      }
    }

    // "he / she / the patient", or a bare "what are the labs?": the patient the conversation is about
    if (
      !subjectIds.length &&
      !staffPerson &&
      !didYouMean.length &&
      (plan.patientRef.kind === 'PRONOUN' ||
        (plan.intent === 'LOOKUP' && plan.patientRef.kind === 'NONE'))
    ) {
      if (activePatientId) subjectIds.push(activePatientId);
    }

    const needsPatient =
      !subjectIds.length &&
      !staffPerson &&
      !didYouMean.length &&
      plan.patientRef.kind !== 'ID' &&
      needsSubject &&
      plan.intent !== 'ACTION' &&
      plan.intent !== 'CLINICAL_REVIEW'
        ? plan.patientRef.kind === 'PRONOUN' ||
          (plan.filters.sections?.length ?? 0) > 0
        : false;

    // "details about Jon Smith" and nobody, not even approximately, is called that: say so, do not let a model improvise.
    // Only when the wording is a lookup of someone ("details about X", "tell me about X", "who is X", "record of X"):
    // "what is the capital of France" or "retry guidance for provider outages" are not patient lookups.
    const named = message.match(
      /\b(?:(?:details?|info(?:rmation)?|records?|history|status|updates?|data|chart|file)\s+(?:about|for|of|on|regarding)|tell me about|who is|look(?:ing)? up|find|show me|pull up|open)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\s*[?.!]*$/i,
    );
    if (
      plan.intent === 'LOOKUP' &&
      !subjectIds.length &&
      !staffPerson &&
      !didYouMean.length &&
      !needsPatient &&
      plan.patientRef.kind === 'NONE' &&
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
      const chart = await direct('getPatientSummary', { patientId: id });
      if (chart) {
        charts.set(id, chart);
        parts.push({ source: `patient chart ${id}`, data: chart });
      }
    }

    let referral: GatheredContext['referral'] = null;
    if (intent.review && subjectIds.length === 1) {
      const r = await direct('reviewReferralNeed', {
        patientId: subjectIds[0],
      });
      if (r) {
        referral = { patientId: subjectIds[0], result: r };
        parts.push({ source: `referral review of ${subjectIds[0]}`, data: r });
      }
    }

    let staff: any = null;
    if (intent.staff) {
      staff = await direct('getStaffSummary', {});
      if (staff) parts.push({ source: 'staff accounts', data: staff });
    }

    let specialists: any = null;
    if (intent.specialists) {
      const all = await direct('findSpecialists', {});
      if (all) {
        // a named specialty ("cardiologists", "neurology") narrows the list; the specialty names come from the data
        const words: string[] = message.toLowerCase().match(/[a-z]{5,}/g) ?? [];
        const wanted =
          (all.specialties as string[]).find(
            (sp) => sp.toLowerCase() === plan.filters.specialty?.toLowerCase(),
          ) ??
          (all.specialties as string[]).find((sp) =>
            words.some(
              (w) =>
                w.length >= 5 && sp.toLowerCase().startsWith(w.slice(0, 5)),
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
      const r = await direct('searchPatients', { stage: 'ALL', limit: 100 });
      if (r) parts.push({ source: 'all patients', data: r });
    } else if (intent.waiting) {
      const r = await direct('searchPatients', {
        stage: 'WAITING',
        limit: 100,
      });
      if (r) parts.push({ source: 'patients waiting for a doctor', data: r });
    }

    if (intent.overview || intent.waiting) {
      const r = await direct('getHospitalOverview', {});
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

    if (intent.crossSearch && !subjectIds.length) {
      const r = await direct('searchClinicalRecords', {
        query: message,
        topK: 6,
      });
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
        staffPerson,
        staffDetail,
        denied,
      };

    const body = parts
      .map(
        (p) =>
          `### ${p.source}\n${fenceData(p.source, JSON.stringify(session.maskDeep(p.data)))}`,
      )
      .join('\n\n');

    return {
      text: `CONTEXT (retrieved by the system just now; authoritative and complete for this user's role). ${FENCE_NOTICE}\n${body}`,
      sources: parts.length,
      notFound,
      onlyNotFound: notFound.length > 0 && parts.length === notFound.length,
      charts,
      needsPatient: false,
      subjectIds,
      referral,
      denied,
      reviewDenied: !!intent.review && subjectIds.length === 1 && !referral,
      corrected,
      specialists,
      staff,
      staffPerson,
      staffDetail,
    };
  }
}
