import {
  parseQuery,
  extractPatientIds,
  isActionRequest,
} from '../query/l1-parser';
import { planToIntent, type Intent } from '../query/plan-to-intent';
import type { OverviewMetric, Vocabulary } from '../query/query-plan';

export type { Intent, OverviewMetric };
export { extractPatientIds, isActionRequest };

/**
 * Routing flags for a message, derived from the structured QueryPlan (see `src/ai/query`). Kept as one function so
 * callers and tests have a single entry point; `vocab` brings in the specialties that exist in the data.
 */
export function classifyIntent(message: string, vocab?: Vocabulary): Intent {
  return planToIntent(parseQuery(message, vocab));
}
