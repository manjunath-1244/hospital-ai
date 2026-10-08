import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { HospitalService } from '../hospital/hospital.service';
import { ClinicalRecordsService } from '../hospital/clinical-records.service';
import { PhiAnonymizerService } from './security/phi-anonymizer.service';
import { AgentContextBuilder } from './context/agent-context.builder';
import { contextHash } from './context/agent-context';
import { VisitsService } from '../hospital/visits/visits.service';
import { toVisitSummary } from '../hospital/visits/visit-summary';
import { ClinicalToolsFactory } from './tools/clinical-tools.factory';
import { createGroundedAgent, createHospitalAgent } from './agent';
import { classifyIntent, extractPatientIds, Intent } from './routing/intent';
import {
  detectSections,
  isPureLookup,
  REFERS_BACK,
  renderChart,
  wantsFullDetails,
} from './routing/chart-view';
import {
  appendOmittedPatients,
  checkGuardrails,
  looksLikeRawToolCall,
  renderPatientList,
} from './guardrails';
import { LlmProvider } from './llm/llm-provider';
import { LlmRunner } from './reliability/llm-runner';
import { PatientSummaryService } from '../hospital/patient-summary.service';
import { News2Service } from '../hospital/news2.service';
import { parseVitals, renderTriage } from './routing/vitals-parser';
import { renderOverview } from './routing/overview-view';
import { ConversationMemoryService } from './memory/conversation-memory.service';
import { SummarizerService } from './memory/summarizer.service';
import { RunRecorder } from './observability/run-recorder';
import { AgentRunsService } from './observability/agent-runs.service';
import { ChatDto, DocumentDto, DocumentType } from './ai.dto';
import type { AuthUser } from '../security/auth-user';
import type { UserRole } from '../security/roles.decorator';

const DOC_ROLES: Record<DocumentType, UserRole[]> = {
  SBAR: ['NURSE', 'DOCTOR', 'ADMIN'],
  PRIOR_AUTH: ['CARE_COORDINATOR', 'DOCTOR', 'ADMIN'],
  DISCHARGE_TRANSLATION: ['CARE_COORDINATOR', 'DOCTOR', 'NURSE', 'ADMIN'],
};

const DISCLAIMER =
  'AI-generated draft from chart data. A qualified clinician must review it before use.';
const PATIENT_ID_ARG = /^[A-Za-z0-9-]{2,32}$/;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly phi: PhiAnonymizerService,
    private readonly tools: ClinicalToolsFactory,
    private readonly llm: LlmProvider,
    private readonly runner: LlmRunner,
    private readonly memory: ConversationMemoryService,
    private readonly summarizer: SummarizerService,
    private readonly runs: AgentRunsService,
    private readonly summaries: PatientSummaryService,
    private readonly visits: VisitsService,
    private readonly contexts: AgentContextBuilder,
    private readonly news2: News2Service,
  ) {}

  /** Every outcome (success or failure) is persisted as a trace; the caller gets the traceId either way. */
  async chat(user: AuthUser, dto: ChatDto) {
    const rec = new RunRecorder('chat', user, this.llm.label());
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
      const intent = classifyIntent(dto.message);
      const context = await rec.step('memory', 'retrieve-context', () =>
        this.gatherContext(
          user,
          dto.message,
          intent,
          session!,
          rec,
          thread.activePatientId,
        ),
      );
      // Grounded mode: when the server found the data, the model only writes the answer (no tool choices to get
      // wrong). Actions and open-ended questions still run the full tool agent.
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
      const agent = grounded
        ? createGroundedAgent({ model, role: user.role })
        : createHospitalAgent({
            model,
            role: user.role,
            tools: this.tools.build({
              user,
              phi: session,
              trace: rec.trace,
              context: agentContext,
            }),
            focusPatientId: thread.activePatientId,
            context: agentContext,
          });

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

      // Some answers need no model at all: exact from system data, instant, impossible to get wrong.
      const pureList =
        intent.list &&
        !intent.policy &&
        !intent.crossSearch &&
        !intent.medication &&
        !intent.write;
      const lookupChart =
        context.charts.size === 1 &&
        isPureLookup(dto.message) &&
        !intent.write &&
        !intent.medication &&
        !intent.policy &&
        !intent.list
          ? [...context.charts.values()][0]
          : null;
      const sections = detectSections(dto.message);
      // NEWS2/SIRS/ESI are calculations, not language: when all five vitals are in the message the server computes them.
      const vitals =
        intent.triage && !intent.write ? parseVitals(dto.message) : null;
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
      // "How many are waiting?" / "overview": numbers straight from the database, no model.
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
      const direct = vitals
        ? renderTriage(vitals, this.news2.assess(vitals))
        : overviewText
          ? overviewText
          : context.onlyNotFound
            ? `No patient with id ${context.notFound.join(', ')} exists in the system. Check the id, or ask me to list the patients.`
            : context.needsPatient && !context.text
              ? 'Which patient do you mean? Tell me the patient\'s name or ID (for example "P1001"), and I will look it up.'
              : lookupChart
                ? renderChart(
                    lookupChart,
                    wantsFullDetails(dto.message) || !sections.length
                      ? 'all'
                      : sections,
                  )
                : pureList
                  ? renderPatientList(rec.trace)
                  : null;

      let result: any = { text: '' };
      let rawStillBroken = false;
      let response: string;
      if (direct) {
        response = direct;
      } else {
        const generate = (msgs: any[]) =>
          rec.step('llm', 'agent.generate', () =>
            this.runner.run(
              'agent.generate',
              () => agent.generate(msgs as any, { maxSteps: 8 } as any),
              () => rec.retries++,
            ),
          );
        result = await generate(messages);
        if (looksLikeRawToolCall(String(result.text ?? ''))) {
          // The model printed a tool call instead of making one. Nudge it once, then refuse to show raw JSON to the user.
          result = await generate([
            ...messages,
            {
              role: 'user',
              content: grounded
                ? 'Do not output JSON or tool calls. Answer in plain language using only the CONTEXT message.'
                : 'You wrote a tool call as plain text. Use the tool-calling interface to call the tool, then answer in plain language using its result.',
            },
          ]);
        }
        rawStillBroken = looksLikeRawToolCall(String(result.text ?? ''));
        response = rawStillBroken
          ? 'I could not complete that request reliably with the current AI model. Please rephrase or try again.'
          : session.restore(result.text);
      }
      const completed =
        !direct && (intent.list || intent.waiting)
          ? appendOmittedPatients(response, rec.trace)
          : { text: response, omitted: 0 };
      response = completed.text;
      const knownText = `${ctx.summary ?? ''}\n${ctx.recent.map((m) => m.content).join('\n')}\n${dto.message}`;
      const guard = checkGuardrails(response, rec.trace, knownText);
      if (rawStillBroken)
        guard.notes.push(
          'The model returned an unusable response (raw tool call).',
        );
      if (completed.omitted)
        guard.notes.push(
          `${completed.omitted} patient(s) the model left out were added from the system data.`,
        );
      if (guard.notes.length) guard.status = 'WARNING';

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
            guardrailStatus: guard.status,
            guardrailNotes: guard.notes,
            usage: result.usage ?? result.totalUsage,
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
        guardrailStatus: guard.status,
        guardrailNotes: guard.notes,
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
      if (err instanceof HttpException) throw err; // 404 foreign thread, 503 breaker/no key: keep the right status
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
   * Retrieve-first routing. The server decides which data the question needs (patient charts, patient list, hospital
   * numbers, policy text, cross-patient search), fetches it through the same role-checked tools the agent has,
   * and returns it as masked CONTEXT. Correctness then depends on the data, not on a model picking the right tool.
   */
  private async gatherContext(
    user: AuthUser,
    message: string,
    intent: Intent,
    session: Awaited<ReturnType<PhiAnonymizerService['createSession']>>,
    rec: RunRecorder,
    activePatientId: string | null,
  ): Promise<{
    text: string | null;
    sources: number;
    notFound: string[];
    onlyNotFound: boolean;
    charts: Map<string, any>;
    needsPatient: boolean;
    subjectIds: string[];
  }> {
    const parts: Array<{ source: string; data: unknown }> = [];
    const ctx = { user, trace: rec.trace };
    const mentioned = await this.hospital.findMentioned(message);
    const charts = new Map<string, any>();

    // Follow-ups ("what medications did the doctor give him?") refer to the patient the conversation is about.
    const otherIntent =
      intent.list ||
      intent.overview ||
      intent.policy ||
      intent.waiting ||
      intent.crossSearch;
    const refersBack =
      REFERS_BACK.test(message) || (isPureLookup(message) && !otherIntent);
    const subjectIds = mentioned.map((p) => p.id);
    if (!subjectIds.length && refersBack && activePatientId)
      subjectIds.push(activePatientId);
    const needsPatient =
      !subjectIds.length &&
      !otherIntent &&
      REFERS_BACK.test(message) &&
      isPureLookup(message);

    // "...gave to him?" with nobody in focus: do not go looking elsewhere (a policy would be a wrong, confident answer).
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

    for (const id of subjectIds) {
      const chart = await this.tools.runDirect(
        'getPatientSummary',
        { patientId: id },
        ctx,
      );
      if (chart) {
        charts.set(id, chart);
        parts.push({ source: `patient chart ${id}`, data: chart });
      }
    }
    if (intent.list) {
      const r = await this.tools.runDirect(
        'searchPatients',
        { stage: 'ALL', limit: 100 },
        ctx,
      );
      if (r) parts.push({ source: 'all patients', data: r });
    } else if (intent.waiting) {
      const r = await this.tools.runDirect(
        'searchPatients',
        { stage: 'WAITING', limit: 100 },
        ctx,
      );
      if (r) parts.push({ source: 'patients waiting for a doctor', data: r });
    }
    if (intent.overview || intent.waiting) {
      const r = await this.tools.runDirect('getHospitalOverview', {}, ctx);
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
    if (intent.crossSearch && !mentioned.length) {
      const r = await this.tools.runDirect(
        'searchClinicalRecords',
        { query: message, topK: 6 },
        ctx,
      );
      if (r) parts.push({ source: 'clinical record search results', data: r });
    }
    // An id that does not exist must produce a clear "not found", never a guess or an unrelated lookup.
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

    // Plain-language questions ("what do we do when a patient gets a rash?") need no keyword: if the policy library has a
    // clearly relevant passage (cosine >= 0.60; unrelated questions score <= 0.56), it is supplied as context.
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
        needsPatient,
        subjectIds,
      };

    const body = parts
      .map(
        (p) => `### ${p.source}\n${JSON.stringify(session.maskDeep(p.data))}`,
      )
      .join('\n\n');
    return {
      text: `CONTEXT (retrieved by the system just now; authoritative and complete for this user's role):\n${body}`,
      sources: parts.length,
      notFound,
      onlyNotFound: notFound.length > 0 && parts.length === notFound.length,
      charts,
      needsPatient: false,
      subjectIds,
    };
  }

  async generateDocument(user: AuthUser, dto: DocumentDto) {
    if (!DOC_ROLES[dto.type].includes(user.role)) {
      throw new ForbiddenException(
        `Role '${user.role}' may not generate ${dto.type} documents`,
      );
    }
    const rec = new RunRecorder('document', user, this.llm.label());
    let session:
      Awaited<ReturnType<PhiAnonymizerService['createSession']>> | undefined;
    try {
      const model = this.llm.getModel();
      const patient = await this.hospital.getPatientById(dto.patientId);
      const [latestVisit] = await this.visits.listForPatient(patient.id, 1);
      const visit = latestVisit ? toVisitSummary(latestVisit) : null;
      const [labs, vitals, consultations, imaging] = await Promise.all([
        this.hospital.getPatientLabs(patient.id),
        this.records.listVitals(patient.id, 5),
        this.records.listConsultations(patient.id, 3),
        this.records.listImagingStudies(patient.id),
      ]);

      session = await this.phi.createSession();
      const chart = session.maskDeep({
        patientId: patient.id,
        name: patient.name,
        age: patient.age,
        gender: patient.gender,
        allergies: patient.allergies,
        currentMedications: patient.currentMedications,
        conditions: patient.conditions,
        currentVisit: visit
          ? {
              status: visit.statusLabel,
              reason: visit.chiefComplaint,
              priority: visit.priority,
              doctor: visit.primaryDoctorName,
            }
          : null,
        labs: labs.slice(0, 10).map((l) => ({
          test: l.testName,
          value: l.value,
          unit: l.unit,
          status: l.status,
          date: l.date,
        })),
        vitals: vitals.map((v) => ({
          at: v.recordedAt,
          hr: v.heartRate,
          sbp: v.bpSystolic,
          spo2: v.spO2,
          temp: v.tempCelsius,
          rr: v.respiratoryRate,
          news2: v.news2Score,
        })),
        consultations: consultations.map((c) => ({
          at: c.createdAt,
          doctor: c.doctorName,
          diagnosis: c.diagnosis,
          prescriptions: c.prescriptions,
          notes: c.notes,
        })),
        imaging: imaging.map((s) => ({
          modality: s.modality,
          description: s.description,
          impression: s.impression,
        })),
      });

      const tasks: Record<DocumentType, string> = {
        SBAR: 'Write a concise SBAR (Situation, Background, Assessment, Recommendation) nursing handoff.',
        PRIOR_AUTH: `Draft an insurance prior-authorization medical-necessity letter for: ${dto.procedure ?? '(procedure not specified: say so and list what is needed)'}. Include clinical justification and prior therapies ONLY if documented. Do not invent CPT/ICD codes, payer policy numbers or dates; write "[to be completed]" instead.`,
        DISCHARGE_TRANSLATION: `Write plain-language discharge instructions from the most recent consultation (medications, follow-up, warning signs), then translate them into ${dto.language ?? 'Spanish'}. Provide the English version and the translation.`,
      };

      const writer = new Agent({
        id: 'clinical-document-writer',
        name: 'Clinical Document Writer',
        instructions:
          'You draft clinical documents using ONLY the chart JSON provided. If information is missing write "not documented". Never invent values, codes, dates or policies. Placeholders like [PATIENT_1] stand for the patient name: reuse them verbatim.',
        model,
      } as any);

      const result: any = await rec.step('llm', 'writer.generate', () =>
        this.runner.run(
          'writer.generate',
          () =>
            writer.generate(
              `${tasks[dto.type]}\n\nCHART:\n${JSON.stringify(chart)}`,
            ),
          () => rec.retries++,
        ),
      );
      await this.runs.save(
        rec.build(
          { status: 'OK', usage: result.usage ?? result.totalUsage },
          session,
        ),
      );
      return {
        success: true,
        type: dto.type,
        content: session.restore(result.text),
        disclaimer: DISCLAIMER,
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
