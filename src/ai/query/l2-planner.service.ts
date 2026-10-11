import { Injectable, Logger } from '@nestjs/common';
import { generateObject } from 'ai';
import { LlmProvider } from '../llm/llm-provider';
import { LlmRunner } from '../reliability/llm-runner';
import { extractPatientIds, isActionRequest } from './l1-parser';
import { QueryPlanSchema, type QueryPlan, type Vocabulary } from './query-plan';
import { withTimeout } from '../reliability/resilience';

const SYSTEM = `You turn ONE hospital staff question into a JSON query plan. You do not answer it and you have no tools.
intent: COUNT (how many/is there any), LIST (who/which/list), LOOKUP (facts about a patient), POLICY_QUERY (hospital rules, SOPs, guidelines), CLINICAL_REVIEW (is a specialist needed?), CLINICAL_QUESTION (drug safety, reasoning about care), SMALLTALK, UNKNOWN.
entity: what the question is about: PATIENT, APPOINTMENT, TASK, LAB, VITALS, MEDICATION, ALLERGY, CONDITION, IMAGING, VISIT, QUEUE, SPECIALIST, STAFF, REFERRAL, POLICY, OTHER (something a hospital system does not hold, e.g. beds), NONE.
scope: HOSPITAL (whole hospital), PATIENT (one patient), SPECIALTY, ROLE, QUEUE.
filters.specialty must be one of the known specialties. filters.role is a staff role.
If you are not sure, use intent UNKNOWN and confidence below 0.5. Never invent patient ids. confidence is 0-1.`;

/**
 * ============================================================================
 * 📝 CONCEPT: STRUCTURED OUTPUT (Schema-Validated JSON Generation)
 * ============================================================================
 * WHAT IT IS:
 * Forcing the LLM to output strictly formatted, type-safe JSON adhering to a
 * formal Zod schema (`QueryPlanSchema`), instead of unstructured conversational text.
 *
 * HOW IMPLEMENTED:
 * Uses Vercel AI SDK's `generateObject` parameterized with:
 * - `schema: QueryPlanSchema`
 * - `temperature: 0` (zero randomness)
 * - Strict enum constraints on intents, entities, scopes, and specialties.
 *
 * USE CASE:
 * Safely parses ambiguous natural language questions into an actionable,
 * machine-readable QueryPlan with intent, entity, and confidence score.
 * ============================================================================
 * L2: used ONLY when the deterministic parser is unsure. A tool-free, schema-validated model call that returns a plan.
 * It can read and classify; it can never create an action (see `accept`).
 */
@Injectable()
export class L2PlannerService {
  private readonly logger = new Logger(L2PlannerService.name);
  private readonly cache = new Map<string, QueryPlan | null>();

  constructor(
    private readonly llm: LlmProvider,
    private readonly runner: LlmRunner,
  ) {}

  enabled(): boolean {
    return (process.env.ROUTE_L2 ?? 'on') !== 'off';
  }

  async plan(
    maskedMessage: string,
    vocab: Vocabulary,
    l1: QueryPlan,
  ): Promise<QueryPlan | null> {
    if (!this.enabled()) return null;
    const key = `${maskedMessage.trim().toLowerCase()}|${vocab.specialties.join(',')}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    let out: QueryPlan | null = null;
    try {
      const { object } = await this.runner.run('route.l2', () =>
        withTimeout(
          () =>
            generateObject({
              model: this.llm.getModel(),
              schema: QueryPlanSchema,
              system: SYSTEM,
              prompt: `Known specialties: ${vocab.specialties.join(', ') || 'none'}.\nQuestion: ${maskedMessage}`,
              temperature: 0,
            }),
          Number(process.env.ROUTE_L2_TIMEOUT_MS ?? 25_000),
          'route.l2',
        ),
      );
      out = this.accept(object as QueryPlan, maskedMessage, l1);
    } catch (err: any) {
      this.logger.warn(`L2 planner failed (${err.message}); falling back`);
    }
    this.cache.set(key, out);
    if (this.cache.size > 300)
      this.cache.delete(this.cache.keys().next().value as string);
    return out;
  }

  /**
   * The safety envelope around a model-made plan: schema-valid (already), read-only, grounded in the message.
   * Returns null when the plan must not be used.
   */
  accept(raw: QueryPlan, message: string, l1: QueryPlan): QueryPlan | null {
    const parsed = QueryPlanSchema.safeParse(raw);
    if (!parsed.success) return null;
    const plan = parsed.data;
    // A model may classify a question; it may not turn one into a change request.
    if (
      ['ACTION', 'CONFIRM', 'DECLINE'].includes(plan.intent) &&
      !isActionRequest(message)
    )
      return null;
    if (plan.intent === 'UNKNOWN') return null;
    // Patient ids come from the message, never from the model.
    const ids = extractPatientIds(message);
    plan.patientRef = ids.length
      ? { kind: 'ID', value: ids[0] }
      : l1.patientRef;
    plan.source = 'L2';
    plan.confidence = Math.min(plan.confidence, 0.85); // a model's confidence is never as good as a rule's certainty
    plan.evidence = [
      ...plan.evidence.slice(0, 6),
      'classified by the model (L1 was unsure)',
    ];
    return plan;
  }
}
