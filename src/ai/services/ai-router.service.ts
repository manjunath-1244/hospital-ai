import { Injectable } from '@nestjs/common';
import { News2Service } from '../../hospital/news2.service';
import { parseVitals, renderTriage } from '../routing/vitals-parser';
import { classifyIntent, Intent } from '../routing/intent';
import {
  detectSections,
  isPureLookup,
  REFERS_BACK,
  renderChart,
  wantsFullDetails,
} from '../routing/chart-view';
import { renderReferralReview } from '../routing/referral-view';
import { renderSpecialists } from '../routing/specialists-view';
import { renderOverview } from '../routing/overview-view';
import { renderPatientList } from '../guardrails';
import { RunRecorder } from '../observability/run-recorder';

export interface DirectResponseResult {
  directText: string | null;
  vitalsCalculated: boolean;
  pureOverview: boolean;
}

@Injectable()
export class AiRouterService {
  constructor(private readonly news2: News2Service) {}

  classify(message: string): Intent {
    return classifyIntent(message);
  }

  evaluateDirectAnswer(
    message: string,
    intent: Intent,
    context: {
      charts: Map<string, any>;
      onlyNotFound: boolean;
      notFound: string[];
      needsPatient: boolean;
      text: string | null;
      referral?: { patientId: string; result: any } | null;
      corrected?: { typed: string; patientId: string; name: string } | null;
      didYouMean?: Array<{ typed: string; patientId: string; name: string }>;
      unknownName?: string | null;
      specialists?: any | null;
    },
    rec: RunRecorder,
  ): DirectResponseResult {
    // 1. NEWS2/SIRS/ESI calculations if vitals present in message
    const vitals = intent.triage && !intent.write ? parseVitals(message) : null;
    if (vitals) {
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
    }

    // 2. Hospital Overview / Waiting count direct response
    const pureOverview =
      (intent.overview || intent.waiting) &&
      !intent.list &&
      !intent.policy &&
      !intent.crossSearch &&
      !intent.medication &&
      !intent.write &&
      !intent.triage &&
      context.charts.size === 0;

    const overviewOut = rec.trace.outputs.find(
      (o) => o.name === 'getHospitalOverview',
    )?.output;

    const overviewText =
      pureOverview && overviewOut
        ? [
            renderOverview(overviewOut),
            intent.waiting &&
            overviewOut.waitingForDoctor + overviewOut.waitingForTriage > 0
              ? `\n${renderPatientList(rec.trace, 'Waiting (for triage or a doctor)') ?? ''}`
              : '',
          ]
            .join('')
            .trim()
        : null;

    // 3. Pure list & pure chart lookup
    const pureList =
      intent.list &&
      !intent.policy &&
      !intent.crossSearch &&
      !intent.medication &&
      !intent.write;

    const lookupChart =
      context.charts.size === 1 &&
      isPureLookup(message) &&
      !intent.write &&
      !intent.medication &&
      !intent.policy &&
      !intent.list
        ? [...context.charts.values()][0]
        : null;

    const sections = detectSections(message);

    // "Is a specialist required?": the rules' verdict is shown exactly (a question, not a request to create anything).
    const referralText =
      intent.review && !intent.write && context.referral
        ? renderReferralReview(
            context.charts.get(context.referral.patientId)?.patient?.name
              ? `${context.charts.get(context.referral.patientId).patient.name} (${context.referral.patientId})`
              : context.referral.patientId,
            context.referral.result,
          )
        : null;

    const clarify = context.didYouMean?.length
      ? `I could not find an exact match. Did you mean ${context.didYouMean.map((d) => `${d.name} (${d.patientId})`).join(' or ')}? Tell me the name or ID and I will look it up.`
      : null;

    const directText0 = vitals
      ? renderTriage(vitals, this.news2.assess(vitals))
      : referralText
        ? referralText
        : overviewText
          ? overviewText
          : context.onlyNotFound
            ? `No patient with id ${context.notFound.join(', ')} exists in the system. Check the id, or ask me to list the patients.`
            : context.needsPatient && !context.text
              ? 'Which patient do you mean? Tell me the patient\'s name or ID (for example "P1001"), and I will look it up.'
              : lookupChart
                ? renderChart(
                    lookupChart,
                    wantsFullDetails(message) || !sections.length
                      ? 'all'
                      : sections,
                  )
                : pureList
                  ? renderPatientList(rec.trace)
                  : null;

    const specialistText =
      intent.specialists && !intent.write && context.specialists
        ? renderSpecialists(context.specialists)
        : null;

    const unknown = context.unknownName
      ? `I could not find a patient named "${context.unknownName}", not even a close spelling. Check the name, or ask me to list the patients.`
      : null;

    const directText =
      clarify ??
      unknown ??
      specialistText ??
      (directText0 && context.corrected
        ? `Showing ${context.corrected.name} (${context.corrected.patientId}); you typed "${context.corrected.typed}".\n${directText0}`
        : directText0);

    return {
      directText,
      vitalsCalculated: !!vitals,
      pureOverview,
    };
  }
}
