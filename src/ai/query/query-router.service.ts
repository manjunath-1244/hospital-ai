import { Injectable } from '@nestjs/common';
import { extractPatientIds, parseQuery } from './l1-parser';
import { resolvePeople } from '../../hospital/person-resolution';
import { HospitalService } from '../../hospital/hospital.service';
import { SpecialistService } from '../../hospital/specialists/specialist.service';
import { L2PlannerService } from './l2-planner.service';
import { VocabularyService } from './vocabulary.service';
import { planToIntent, type Intent } from './plan-to-intent';
import { CONFIDENT, MINIMUM, type Hints, type QueryPlan } from './query-plan';
import { clarificationFor, decidePlan, type RouteOutcome } from './clarify';

export interface RouteDecision {
  plan: QueryPlan;
  intent: Intent;
  /** HANDLE: run the plan's handler; CLARIFY: ask back with the real options; AGENT: open-ended, let the agent investigate. */
  outcome: RouteOutcome;
  clarification?: string;
  /** The model planner was consulted (L1 alone was not confident). */
  usedL2: boolean;
}

/**
 * question -> QueryPlan (L1 rules; L2 model only when unsure) -> decision.
 * Never guesses: below the minimum confidence it asks or hands the question to the agent.
 */
@Injectable()
export class QueryRouterService {
  constructor(
    private readonly vocabulary: VocabularyService,
    private readonly l2: L2PlannerService,
    private readonly hospital: HospitalService,
    private readonly specialists: SpecialistService,
  ) {}

  /** Is a patient or a staff member named in the message? (ids are handled by the parser itself) */
  private async hintsFor(message: string): Promise<Hints> {
    if (extractPatientIds(message).length) return {};
    try {
      const staff = Object.values(await this.specialists.staffByRole())
        .flat()
        .map((s) => ({
          kind: 'STAFF' as const,
          id: s.id,
          name: `${s.name}${s.specialty ? ` (${s.specialty})` : ''}`,
        }));
      const found = resolvePeople(message, [
        ...(await this.hospital.allPatientBriefs()),
        ...staff,
      ]);
      if (found.status === 'NONE') return { person: 'NONE' };
      if (found.status === 'AMBIGUOUS') return { person: 'AMBIGUOUS' };
      return {
        person: found.matches.some((m) => m.person.kind === 'PATIENT')
          ? 'PATIENT'
          : 'STAFF',
      };
    } catch {
      return {}; // name hints are an improvement, never a requirement
    }
  }

  async decide(
    message: string,
    maskedMessage: string = message,
  ): Promise<RouteDecision> {
    const vocab = await this.vocabulary.get();
    let plan = parseQuery(message, vocab, await this.hintsFor(message));
    let usedL2 = false;

    // Ask the model only when the rules truly cannot tell: below the minimum confidence, or two readings compete.
    // (A plan that is merely below "certain" but clear is used as it is: no slow second opinion for it.)
    const settled =
      ['ACTION', 'CONFIRM', 'DECLINE'].includes(plan.intent) ||
      plan.confidence >= CONFIDENT() ||
      clarificationFor(plan) !== null ||
      (plan.confidence >= MINIMUM() && clarificationFor(plan) === null);
    if (!settled && this.l2.enabled()) {
      usedL2 = true;
      const second = await this.l2.plan(maskedMessage, vocab, plan);
      if (second && second.confidence > plan.confidence) {
        second.alternatives = second.alternatives.length
          ? second.alternatives
          : plan.alternatives;
        plan = second;
      }
    }

    const verdict = decidePlan(plan);
    return {
      plan,
      intent: planToIntent(plan),
      usedL2,
      outcome: verdict.outcome,
      clarification: verdict.clarification,
    };
  }
}
