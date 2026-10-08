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
import type { AuthUser } from '../security/auth-user';

const PATIENT_ID_ARG = /^[A-Za-z0-9-]{2,32}$/;

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
      const intent = this.router.classify(dto.message);
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
      const lastPatient = [...rec.trace.calls]
        .reverse()
        .find(
          (c) =>
            c.success &&
            typeof (c.args as any)?.patientId === 'string' &&
            PATIENT_ID_ARG.test((c.args as any).patientId),
        );
      await this.memory.setActivePatient(
        thread,
        (lastPatient?.args as any)?.patientId,
      );

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
        })),
        citations: rec.trace.citations,
        proposals: proposalsFromTrace(rec.trace),
        guardrailStatus,
        guardrailNotes,
        hipaaShieldActive: session.active,
        mode: grounded ? 'grounded' : 'agent',
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

  /** Stream chunks from model generation for streaming chat requests. */
  async *chatStream(user: AuthUser, dto: ChatDto) {
    const model = this.llm.getModel();
    const session = await this.phi.createSession();
    const rec = new RunRecorder('chat-stream', user, this.llm.label());
    rec.setGoal(dto.message);

    const thread = await this.memory.getOrCreateThread(
      user,
      dto.threadId,
      dto.message,
    );
    const ctx = await this.memory.buildContext(thread, (prev, msgs) =>
      this.summarizer.summarize(prev, msgs),
    );

    const intent = this.router.classify(dto.message);
    const context = await this.contextService.gatherContext(
      user,
      dto.message,
      intent,
      session,
      rec,
      thread.activePatientId,
    );

    const directResult = this.router.evaluateDirectAnswer(
      dto.message,
      intent,
      context,
      rec,
    );

    if (directResult.directText) {
      yield directResult.directText;
      return;
    }

    const grounded =
      !!context.text && !intent.write && !intent.medication && !intent.triage;

    const agentContext = this.tools.applyPolicy(
      await this.contexts.build({
        user,
        subjectIds: context.subjectIds,
        thread: {
          id: thread.id,
          activePatientId: thread.activePatientId,
          summarized: ctx.summarized,
        },
      }),
    );

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
        content: session.mask(m.content),
      })),
      { role: 'user' as const, content: session.mask(dto.message) },
    ];

    yield* this.answerService.streamAgent(
      user,
      model,
      grounded,
      agentContext,
      session,
      rec,
      thread.activePatientId,
      messages,
    );
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
