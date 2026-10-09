import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PhiAnonymizerService } from './security/phi-anonymizer.service';
import { AgentContextBuilder } from './context/agent-context.builder';
import { contextHash } from './context/agent-context';
import { ClinicalToolsFactory } from './tools/clinical-tools.factory';
import { LlmProvider } from './llm/llm-provider';
import { ConversationMemoryService } from './memory/conversation-memory.service';
import { SummarizerService } from './memory/summarizer.service';
import { RunRecorder } from './observability/run-recorder';
import { AgentRunsService } from './observability/agent-runs.service';
import { ChatDto, DocumentDto } from './ai.dto';
import { AiRouterService } from './services/ai-router.service';
import { AiContextService } from './services/ai-context.service';
import { AiAnswerService } from './services/ai-answer.service';
import { proposalsFromTrace } from './guardrails';
import {
  QueryRouterService,
  type RouteDecision,
} from './query/query-router.service';
import { PendingActionsService } from './actions/pending-actions.service';
import type { RouteTrace } from '../database/entities/agent-run.entity';
import type { AuthUser } from '../security/auth-user';


@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly phi: PhiAnonymizerService,
    private readonly tools: ClinicalToolsFactory,
    private readonly llm: LlmProvider,
    private readonly memory: ConversationMemoryService,
    private readonly summarizer: SummarizerService,
    private readonly runs: AgentRunsService,
    private readonly contexts: AgentContextBuilder,
    private readonly router: AiRouterService,
    private readonly contextService: AiContextService,
    private readonly answerService: AiAnswerService,
    private readonly queryRouter: QueryRouterService,
    private readonly pending: PendingActionsService,
  ) {}

  /** Every chat outcome (success or failure) is persisted as a trace; the caller gets the traceId either way. */
  async chat(user: AuthUser, dto: ChatDto) {
    const rec = new RunRecorder('chat', user, this.llm.label());
    rec.setGoal(dto.message);
    let threadId: string | null = dto.threadId ?? null;
    let session:
      Awaited<ReturnType<PhiAnonymizerService['createSession']>> | undefined;

    try {
      const model = this.llm.getModel();
      const thread = await rec.step('memory', 'load-thread', () =>
        this.memory.getOrCreateThread(user, dto.threadId, dto.message),
      );
      threadId = thread.id;
      const ctx = await rec.step('memory', 'build-context', () =>
        this.memory.buildContext(thread, (prev, msgs) =>
          this.summarizer.summarize(prev, msgs),
        ),
      );

      session = await this.phi.createSession();
      // Understand the question first (plan + confidence); the plan, not the wording, decides everything after this.
      const decision = await rec.step('memory', 'route', () =>
        this.queryRouter.decide(dto.message, session!.mask(dto.message)),
      );
      const intent = decision.intent;
      rec.route = this.routeTrace(decision, 'pending');

      // Turns answered without fetching anything: asking back, or replying to a pending proposal.
      const early = await this.earlyAnswer(
        decision,
        dto.message,
        user,
        thread.id,
      );
      if (early) {
        rec.route = this.routeTrace(decision, early.handler);
        return this.finishEarly(
          rec,
          user,
          thread,
          dto.message,
          early.text,
          session,
          ctx,
          early.handler,
        );
      }

      const context = await rec.step('memory', 'retrieve-context', () =>
        this.contextService.gatherContext(
          user,
          dto.message,
          intent,
          session!,
          rec,
          thread.activePatientId,
        ),
      );

      // Direct response calculation via router sub-service
      const directResult = this.router.evaluateDirectAnswer(
        dto.message,
        intent,
        context,
        rec,
      );

      // Grounded mode: when the server found the data, the model only writes the answer.
      const grounded =
        !!context.text && !intent.write && !intent.medication && !intent.triage;
      rec.route = this.routeTrace(
        decision,
        directResult.directText
          ? directResult.handler
          : grounded
            ? 'grounded.model'
            : 'agent.model',
      );

      const agentContext = await rec.step(
        'memory',
        'build-agent-context',
        async () =>
          this.tools.applyPolicy(
            await this.contexts.build({
              user,
              subjectIds: context.subjectIds,
              thread: {
                id: thread.id,
                activePatientId: thread.activePatientId,
                summarized: ctx.summarized,
              },
            }),
          ),
      );
      rec.context = { hash: contextHash(agentContext), snapshot: agentContext };

      const messages = [
        ...(ctx.summary
          ? [
              {
                role: 'system' as const,
                content: `Summary of the earlier conversation:\n${session.mask(ctx.summary)}`,
              },
            ]
          : []),
        ...(context.text
          ? [{ role: 'system' as const, content: context.text }]
          : []),
        ...ctx.recent.map((m) => ({
          role: m.role,
          content: session!.mask(m.content),
        })),
        { role: 'user' as const, content: session.mask(dto.message) },
      ];

      let response: string;
      let guardrailStatus = 'VERIFIED_SAFE';
      let guardrailNotes: string[] = [];
      let resultUsage: any = null;

      if (directResult.directText) {
        response = directResult.directText;
      } else {
        const knownText = `${ctx.summary ?? ''}\n${ctx.recent.map((m) => m.content).join('\n')}\n${dto.message}`;
        const outcome = await this.answerService.executeAgent(
          user,
          model,
          grounded,
          agentContext,
          session,
          rec,
          thread.activePatientId,
          messages,
          dto.message,
          intent,
          knownText,
        );
        response = outcome.response;
        guardrailStatus = outcome.guardrailStatus;
        guardrailNotes = outcome.guardrailNotes;
        resultUsage = outcome.result.usage ?? outcome.result.totalUsage;
      }

      await this.memory.append(thread.id, 'user', dto.message);
      await this.memory.append(thread.id, 'assistant', response);
      // The conversation's patient changes only when THIS message names exactly one patient (or already resolved to the
      // current one). A patient the model happened to read along the way never becomes the focus of later turns.
      if (context.subjectIds?.length === 1)
        await this.memory.setActivePatient(thread, context.subjectIds[0]);

      await this.runs.save(
        rec.build(
          {
            status: 'OK',
            guardrailStatus,
            guardrailNotes,
            usage: resultUsage,
            threadId: thread.id,
          },
          session,
        ),
      );

      return {
        success: true,
        response,
        threadId: thread.id,
        traceId: rec.traceId,
        toolCalls: rec.trace.calls.map((c) => ({
          name: c.name,
          args: c.args,
          success: c.success,
          auto: !!c.auto,
          durationMs: c.durationMs ?? 0,
          ...(c.error ? { error: c.error } : {}),
        })),
        citations: rec.trace.citations,
        proposals: proposalsFromTrace(rec.trace),
        guardrailStatus,
        guardrailNotes,
        hipaaShieldActive: session.active,
        mode: directResult.directText
          ? 'direct'
          : grounded
            ? 'grounded'
            : 'agent',
        route: rec.route,
        memory: {
          summarized: ctx.summarized,
          messagesInContext: ctx.recent.length + 1,
        },
      };
    } catch (err: any) {
      await this.runs.save(
        rec.build(
          {
            status: 'ERROR',
            error: String(err?.message ?? err).slice(0, 500),
            threadId,
          },
          session,
        ),
      );
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Agent error [${rec.traceId}]: ${err.message}`,
        err.stack,
      );
      return {
        success: false,
        error: 'The AI agent failed to produce a response. Please try again.',
        traceId: rec.traceId,
        threadId,
      };
    }
  }

  /**
   * Streaming endpoint. It runs the SAME pipeline as chat() (routing, tools, guardrails, claim reconciliation, memory,
   * run trace) and returns the verified answer in one chunk: a separate streaming pipeline would skip those checks.
   */
  async *chatStream(user: AuthUser, dto: ChatDto) {
    const result: any = await this.chat(user, dto);
    yield result?.response ?? result?.error ?? '';
  }

  private routeTrace(decision: RouteDecision, handler: string): RouteTrace {
    const p = decision.plan;
    return {
      intent: p.intent,
      entity: p.entity,
      scope: p.scope,
      filters: p.filters as Record<string, unknown>,
      confidence: p.confidence,
      source: p.source,
      usedL2: decision.usedL2,
      decision: decision.outcome,
      handler,
      alternatives: p.alternatives,
    };
  }

  /**
   * Turns that need no data lookup and no model: a question back when we cannot tell what is meant, and "yes / no"
   * replies, which belong to the proposals waiting in THIS conversation (and to nothing else).
   */
  private async earlyAnswer(
    decision: RouteDecision,
    message: string,
    user: AuthUser,
    threadId: string,
  ): Promise<{ text: string; handler: string } | null> {
    const intent = decision.plan.intent;
    if (decision.outcome === 'CLARIFY' && decision.clarification)
      return { text: decision.clarification, handler: 'clarify' };
    if (intent === 'CONFIRM' || intent === 'DECLINE') {
      const r = await this.pending.reply(intent, message, user, threadId);
      return {
        text: r.text,
        handler: intent === 'CONFIRM' ? 'pending.confirm' : 'pending.decline',
      };
    }
    if (intent === 'SMALLTALK')
      return {
        text: 'Hello. Ask me about a patient (by name or ID), the waiting room, appointments, specialists, or hospital policies. I can also prepare a referral, appointment or task for your approval.',
        handler: 'smalltalk',
      };
    return null;
  }

  /** Saves the turn and returns the standard response for an answer produced without the data/model pipeline. */
  private async finishEarly(
    rec: RunRecorder,
    user: AuthUser,
    thread: { id: string },
    message: string,
    text: string,
    session: { active: boolean },
    ctx: { summarized: boolean; recent: unknown[] },
    handler: string,
  ) {
    await this.memory.append(thread.id, 'user', message);
    await this.memory.append(thread.id, 'assistant', text);
    await this.runs.save(
      rec.build(
        {
          status: 'OK',
          guardrailStatus: 'VERIFIED_SAFE',
          guardrailNotes: [],
          threadId: thread.id,
        },
        session as any,
      ),
    );
    return {
      success: true,
      response: text,
      threadId: thread.id,
      traceId: rec.traceId,
      toolCalls: [],
      citations: [],
      proposals: [],
      guardrailStatus: 'VERIFIED_SAFE',
      guardrailNotes: [],
      hipaaShieldActive: session.active,
      mode: handler.startsWith('pending') ? 'pending' : handler,
      route: rec.route,
      memory: {
        summarized: ctx.summarized,
        messagesInContext: ctx.recent.length + 1,
      },
    };
  }

  async generateDocument(user: AuthUser, dto: DocumentDto) {
    const rec = new RunRecorder('document', user, this.llm.label());
    rec.setGoal(`Generate ${dto.type} document for patient ${dto.patientId}`);
    let session:
      Awaited<ReturnType<PhiAnonymizerService['createSession']>> | undefined;

    try {
      const model = this.llm.getModel();
      session = await this.phi.createSession();
      const outcome = await this.answerService.generateDocument(
        user,
        model,
        dto,
        session,
        rec,
      );

      await this.runs.save(
        rec.build({ status: 'OK', usage: outcome.usage }, session),
      );

      return {
        success: true,
        type: dto.type,
        content: outcome.text,
        disclaimer: outcome.disclaimer,
        traceId: rec.traceId,
      };
    } catch (err: any) {
      await this.runs.save(
        rec.build(
          { status: 'ERROR', error: String(err?.message ?? err).slice(0, 500) },
          session,
        ),
      );
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Document generation failed [${rec.traceId}]: ${err.message}`,
        err.stack,
      );
      return {
        success: false,
        error: 'Document generation failed. Please try again.',
        traceId: rec.traceId,
      };
    }
  }
}
