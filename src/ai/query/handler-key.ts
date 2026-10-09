import type { QueryPlan } from './query-plan';

/**
 * Which handler answers a plan. One table-like function from (intent, entity, scope, filters) to a name; the router
 * owns the handlers themselves. "deterministic" handlers answer from system data without a model; the rest need a model
 * (grounded on retrieved data, or the tool agent).
 */
export type HandlerKey =
  | 'calculate.vitals'
  | 'count.overview'
  | 'count.specialists'
  | 'count.staff'
  | 'count.unsupported'
  | 'list.specialists'
  | 'list.staff'
  | 'list.waiting'
  | 'list.patients'
  | 'search.records'
  | 'lookup.chart'
  | 'lookup.staff'
  | 'review.referral'
  | 'policy.rag'
  | 'clinical.agent'
  | 'action.agent'
  | 'pending.confirm'
  | 'pending.decline'
  | 'smalltalk'
  | 'clarify'
  | 'agent.fallback';

export const DETERMINISTIC: ReadonlySet<HandlerKey> = new Set<HandlerKey>([
  'calculate.vitals',
  'count.overview',
  'count.specialists',
  'count.staff',
  'count.unsupported',
  'list.specialists',
  'list.staff',
  'list.waiting',
  'list.patients',
  'lookup.chart',
  'lookup.staff',
  'review.referral',
  'pending.confirm',
  'pending.decline',
  'smalltalk',
  'clarify',
]);

export function handlerKey(plan: QueryPlan): HandlerKey {
  const { intent, entity } = plan;
  switch (intent) {
    case 'CALCULATE':
      return 'calculate.vitals';
    case 'ACTION':
      return 'action.agent';
    case 'CONFIRM':
      return 'pending.confirm';
    case 'DECLINE':
      return 'pending.decline';
    case 'SMALLTALK':
      return 'smalltalk';
    case 'CLINICAL_REVIEW':
      return 'review.referral';
    case 'CLINICAL_QUESTION':
      return 'clinical.agent';
    case 'POLICY_QUERY':
      return 'policy.rag';
    case 'COUNT':
      if (entity === 'SPECIALIST') return 'count.specialists';
      if (entity === 'STAFF') return 'count.staff';
      if (entity === 'OTHER') return 'count.unsupported';
      if (entity === 'NONE') return 'clarify';
      return 'count.overview';
    case 'LIST':
      if (entity === 'SPECIALIST') return 'list.specialists';
      if (entity === 'STAFF') return 'list.staff';
      if (entity === 'QUEUE') return 'list.waiting';
      if (entity === 'PATIENT')
        return plan.filters.search ? 'search.records' : 'list.patients';
      return 'agent.fallback';
    case 'LOOKUP':
      return entity === 'STAFF' ? 'lookup.staff' : 'lookup.chart';
    default:
      return 'agent.fallback';
  }
}
