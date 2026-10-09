import { missingActionDetails } from '../query/action-slots';
import { Injectable } from '@nestjs/common';
import { News2Service } from '../../hospital/news2.service';
import { parseVitals, renderTriage } from '../routing/vitals-parser';
import type { Intent } from '../routing/intent';
import {
  detectSections,
  ENTITY_SECTION,
  renderChart,
  wantsFullDetails,
  type Section,
} from '../routing/chart-view';
import { renderReferralReview } from '../routing/referral-view';
import { renderSpecialists } from '../routing/specialists-view';
import { renderStaff } from '../routing/staff-view';
import {
  renderOverview,
  renderUnsupportedCount,
} from '../routing/overview-view';
import { renderLongestWaiting, renderPatientList } from '../guardrails';
import { RunRecorder } from '../observability/run-recorder';
import { handlerKey, type HandlerKey } from '../query/handler-key';

/** What the context gatherer found for this turn (data fetched through role-checked tools). */
export interface TurnContext {
  charts: Map<string, any>;
  onlyNotFound: boolean;
  notFound: string[];
  needsPatient: boolean;
  subjectIds?: string[];
  text: string | null;
  referral?: { patientId: string; result: any } | null;
  reviewDenied?: boolean;
  denied?: string[];
  corrected?: { typed: string; patientId: string; name: string } | null;
  didYouMean?: Array<{
    typed: string;
    patientId: string;
    name: string;
    kind?: string;
  }>;
  unknownName?: string | null;
  specialists?: any | null;
  staff?: any | null;
  staffPerson?: {
    name: string;
    kind: string;
    exact: boolean;
    typed: string;
  } | null;
  staffDetail?: string | null;
}

export interface DirectResponseResult {
  /** The exact answer, when a deterministic handler produced one; null means a model must answer. */
  directText: string | null;
  /** The handler that was chosen from the plan (also recorded on the run). */
  handler: HandlerKey;
  vitalsCalculated: boolean;
}

interface HandlerInput {
  message: string;
  intent: Intent;
  context: TurnContext;
  rec: RunRecorder;
}
type Handler = (i: HandlerInput) => string | null;

/** What the user is told when the data a deterministic answer needs is not available to their role. */
function refusalFor(tool: string): string {
  switch (tool) {
    case 'getPatientSummary':
      return "I cannot show that patient's chart to your role. Specialists can open a chart only through a referral assigned to them; other roles see only the sections their job needs.";
    case 'getHospitalOverview':
      return 'Hospital-wide figures are not available to your role. Doctors, nurses, receptionists, care coordinators and administrators can see them.';
    case 'searchPatients':
      return 'Your role cannot list or search patients.';
    case 'getStaffSummary':
      return 'Staff counts and names are not available to your role.';
    case 'findSpecialists':
      return 'The specialist directory is not available to your role.';
    case 'searchClinicalRecords':
      return 'Searching across patient records is not available to your role.';
    default:
      return 'That information is not available to your role.';
  }
}

/**
 * Executes the handler a QueryPlan selects. Every handler answers ONLY from data the server fetched (or computed), or
 * returns null so a model answers; none of them looks at the wording of the question beyond what the plan carries.
 */
@Injectable()
export class AiRouterService {
  constructor(private readonly news2: News2Service) {}

  private readonly handlers: Partial<Record<HandlerKey, Handler>> = {
    'calculate.vitals': ({ message, rec }) => {
      const vitals = parseVitals(message);
      if (!vitals) return null; // missing values: the model/tool path asks for them, no score is invented
      const t0 = Date.now();
      const assessment = this.news2.assess(vitals);
      rec.trace.record(
        {
          name: 'assessTriage',
          args: vitals,
          success: true,
          auto: true,
          startedAtMs: t0,
          durationMs: Date.now() - t0,
        },
        { success: true, ...assessment },
      );
      return renderTriage(vitals, assessment);
    },
    'count.overview': ({ intent, context, rec }) =>
      this.overview(intent, context, rec),
    'list.waiting': ({ intent, context, rec }) =>
      intent.plan.filters.rank === 'LONGEST_WAIT'
        ? renderLongestWaiting(rec.trace)
        : this.overview(intent, context, rec),
    'count.specialists': ({ context }) =>
      context.specialists ? renderSpecialists(context.specialists) : null,
    'list.specialists': ({ context }) =>
      context.specialists ? renderSpecialists(context.specialists) : null,
    'count.staff': ({ message, context }) =>
      context.staff ? renderStaff(context.staff, message) : null,
    'list.staff': ({ message, context }) =>
      context.staff ? renderStaff(context.staff, message) : null,
    'count.unsupported': ({ intent }) =>
      renderUnsupportedCount(intent.countedNoun),
    'list.patients': ({ rec }) => renderPatientList(rec.trace),
    'lookup.chart': ({ message, intent, context }) => {
      if (context.charts.size > 1)
        return `You mentioned more than one patient (${[...context.charts.values()].map((c: any) => `${c.patient?.name} (${c.patient?.id})`).join(' and ')}). Which one do you mean? Ask about one patient at a time.`;
      if (context.charts.size !== 1) return null;
      // what the parser understood (typos repaired) first; the chart's own word list only as a fallback
      const fromPlan = (intent.plan.filters.sections ?? [])
        .map((e) => ENTITY_SECTION[e.toUpperCase()])
        .filter(Boolean) as Section[];
      const sections = fromPlan.length ? fromPlan : detectSections(message);
      const chart = [...context.charts.values()][0];
      // contact details are not part of the chart the assistant shows
      if (/\b(phone|mobile|telephone|address|e-?mail)\b/i.test(message))
        return `${renderChart(chart, [])}\nContact details (phone, address, e-mail) are not shown by the assistant; open the patient's record on the front-desk screen.`;
      return renderChart(
        [...context.charts.values()][0],
        wantsFullDetails(message) || !sections.length ? 'all' : sections,
      );
    },
    'lookup.staff': ({ context }) => context.staffDetail ?? null,
    'review.referral': ({ context }) => {
      if (!context.referral)
        return context.reviewDenied
          ? 'Your role cannot run a specialist-need review: it uses clinical data that is limited to doctors, nurses and administrators. Ask one of them, or tell me what you need prepared.'
          : null;
      const chart = context.charts.get(context.referral.patientId);
      const label = chart?.patient?.name
        ? `${chart.patient.name} (${context.referral.patientId})`
        : context.referral.patientId;
      return renderReferralReview(label, context.referral.result);
    },
  };

  /** Waiting-room and hospital figures (only the numbers asked for), plus the people when the waiting room is asked about. */
  private overview(
    intent: Intent,
    context: TurnContext,
    rec: RunRecorder,
  ): string | null {
    if (context.charts.size) return null; // a question about a named patient is not a hospital figure
    const out = rec.trace.outputs.find(
      (o) => o.name === 'getHospitalOverview',
    )?.output;
    if (!out) return null;
    const people =
      intent.waiting && out.waitingForDoctor + out.waitingForTriage > 0
        ? `\n${renderPatientList(rec.trace, 'Waiting (for triage or a doctor)') ?? ''}`
        : '';
    return `${renderOverview(out, intent.metrics)}${people}`.trim();
  }

  /**
   * Entity-resolution outcomes come first: whatever the plan, if the patient could not be identified the answer is a
   * question or a "not found", never a guess.
   */
  private resolutionOutcome(context: TurnContext): string | null {
    if (context.didYouMean?.length)
      return `I could not find an exact match. Did you mean ${context.didYouMean.map((d) => `${d.name} (${d.kind === 'STAFF' ? 'staff' : `patient ${d.patientId}`})`).join(' or ')}? Tell me which, by name or ID, and I will look it up.`;
    if (context.staffDetail)
      return `${context.staffPerson && !context.staffPerson.exact ? `Showing ${context.staffPerson.name}; you typed "${context.staffPerson.typed}".\n` : ''}${context.staffDetail}`;
    if (context.unknownName)
      return `I could not find a patient named "${context.unknownName}", not even a close spelling. Check the name, or ask me to list the patients.`;
    if (context.onlyNotFound)
      return `No patient with id ${context.notFound.join(', ')} exists in the system. Check the id, or ask me to list the patients.`;
    if (context.needsPatient && !context.text)
      return 'Which patient do you mean? Tell me the patient\'s name or ID (for example "P1001"), and I will look it up.';
    return null;
  }

  evaluateDirectAnswer(
    message: string,
    intent: Intent,
    context: TurnContext,
    rec: RunRecorder,
  ): DirectResponseResult {
    const handler = handlerKey(intent.plan);
    if (intent.plan.intent === 'ACTION') {
      const ask = missingActionDetails(
        message,
        (context.subjectIds?.length ?? 0) > 0 ||
          context.charts.size > 0 ||
          context.notFound.length > 0 ||
          !!context.didYouMean?.length ||
          !!context.unknownName,
      );
      if (ask)
        return {
          directText: ask,
          handler: 'clarify',
          vitalsCalculated: false,
        };
    }
    const early =
      intent.plan.intent === 'ACTION' ? null : this.resolutionOutcome(context);
    if (early)
      return {
        directText: early,
        // a named staff member is ANSWERED (who they are), the other outcomes are questions or "not found"
        handler:
          context.staffDetail && early.includes(context.staffDetail)
            ? 'lookup.staff'
            : 'clarify',
        vitalsCalculated: false,
      };

    const run = this.handlers[handler];
    let text = run ? run({ message, intent, context, rec }) : null;
    // The data this question needs was withheld from this role: say so, never hand it to a model to improvise around.
    if (!text && context.denied?.length)
      text =
        intent.plan.intent === 'ACTION' &&
        context.denied[0] === 'getPatientSummary'
          ? "I cannot prepare a change for that patient: your role has no access to this patient's record (a specialist works only with patients referred to them). Nothing was created."
          : refusalFor(context.denied[0]);
    // an id the user typed that does not exist is said, even when another patient was answered
    if (text && context.notFound.length && context.charts.size)
      text = `Note: no patient with id ${context.notFound.join(', ')} exists in the system.\n${text}`;
    const disclosed =
      text && context.corrected
        ? `Showing ${context.corrected.name} (${context.corrected.patientId}); you typed "${context.corrected.typed}".\n${text}`
        : text;
    return {
      directText: disclosed,
      handler,
      vitalsCalculated: handler === 'calculate.vitals' && !!text,
    };
  }
}
