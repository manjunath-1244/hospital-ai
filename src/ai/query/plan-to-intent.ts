import type { OverviewMetric, QueryPlan } from './query-plan';

/**
 * The execution flags the context gatherer and the router work with, DERIVED from the plan. The plan is the single
 * source of truth; nothing here reads the wording of the question.
 */
export interface Intent {
  /** A change request or a reply to a pending proposal: needs the tool agent, never grounded-only mode. */
  write: boolean;
  list: boolean;
  waiting: boolean;
  overview: boolean;
  policy: boolean;
  triage: boolean;
  medication: boolean;
  crossSearch: boolean;
  review: boolean;
  specialists: boolean;
  staff: boolean;
  metrics: OverviewMetric[];
  unsupported: boolean;
  countedNoun: string | null;
  /** The plan these flags came from. */
  plan: QueryPlan;
}

export function planToIntent(plan: QueryPlan): Intent {
  const { intent, entity, filters } = plan;
  const people = entity === 'SPECIALIST' || entity === 'STAFF';
  return {
    write: intent === 'ACTION' || intent === 'CONFIRM' || intent === 'DECLINE',
    list: intent === 'LIST' && entity === 'PATIENT' && !filters.search,
    crossSearch: intent === 'LIST' && entity === 'PATIENT' && !!filters.search,
    waiting: entity === 'QUEUE' || !!filters.metrics?.includes('waiting'),
    overview:
      intent === 'COUNT' && !people && entity !== 'OTHER' && entity !== 'NONE',
    metrics: intent === 'COUNT' ? (filters.metrics ?? []) : [],
    policy: intent === 'POLICY_QUERY',
    triage: intent === 'CALCULATE',
    medication: intent === 'CLINICAL_QUESTION' && !!filters.safety,
    review: intent === 'CLINICAL_REVIEW',
    specialists:
      entity === 'SPECIALIST' && (intent === 'COUNT' || intent === 'LIST'),
    staff: entity === 'STAFF' && (intent === 'COUNT' || intent === 'LIST'),
    unsupported: intent === 'COUNT' && entity === 'OTHER',
    countedNoun:
      intent === 'COUNT' && entity === 'OTHER' ? (plan.noun ?? null) : null,
    plan,
  };
}
