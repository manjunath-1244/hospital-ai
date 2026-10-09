import { stripFence } from '../data-fence';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { createGroundedAgent, createHospitalAgent } from '../agent';
import { ClinicalToolsFactory } from '../tools/clinical-tools.factory';
import {
  appendOmittedPatients,
  checkGuardrails,
  looksLikeRawToolCall,
  reconcileActionClaims,
  appendClosestPassage,
} from '../guardrails';
import { LlmRunner } from '../reliability/llm-runner';
import { PhiAnonymizerService } from '../security/phi-anonymizer.service';
import { AuthUser } from '../../security/auth-user';
import { RunRecorder } from '../observability/run-recorder';
import { DocumentDto, DocumentType } from '../ai.dto';
import { HospitalService } from '../../hospital/hospital.service';
import { ClinicalRecordsService } from '../../hospital/clinical-records.service';
import { VisitsService } from '../../hospital/visits/visits.service';
import { toVisitSummary } from '../../hospital/visits/visit-summary';

const DOC_ROLES: Record<DocumentType, string[]> = {
  SBAR: ['NURSE', 'DOCTOR', 'ADMIN'],
  PRIOR_AUTH: ['CARE_COORDINATOR', 'DOCTOR', 'ADMIN'],
  DISCHARGE_TRANSLATION: ['CARE_COORDINATOR', 'DOCTOR', 'NURSE', 'ADMIN'],
};

const DISCLAIMER =
  'AI-generated draft from chart data. A qualified clinician must review it before use.';

export interface GenerationOutcome {
  response: string;
  result: any;
  guardrailStatus: string;
  guardrailNotes: string[];
}

@Injectable()
export class AiAnswerService {
  constructor(
    private readonly runner: LlmRunner,
    private readonly tools: ClinicalToolsFactory,
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly visits: VisitsService,
  ) {}

  async executeAgent(
    user: AuthUser,
    model: any,
    grounded: boolean,
    agentContext: any,
    session: Awaited<ReturnType<PhiAnonymizerService['createSession']>>,
    rec: RunRecorder,
    activePatientId: string | null,
    messages: any[],
    dtoMessage: string,
    intent: any,
    knownText: string,
  ): Promise<GenerationOutcome> {
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
            traceId: rec.traceId,
          }),
          focusPatientId: activePatientId,
          context: agentContext,
        });

    const generate = (msgs: any[]) =>
      rec.step('llm', 'agent.generate', () =>
        this.runner.run(
          'agent.generate',
          () =>
            agent.generate(msgs as any, { maxSteps: 8, maxRetries: 0 } as any),
          () => rec.retries++,
        ),
      );

    let result: any = await generate(messages);
    if (looksLikeRawToolCall(String(result.text ?? ''))) {
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

    const rawStillBroken = looksLikeRawToolCall(String(result.text ?? ''));
    let response = rawStillBroken
      ? 'I could not complete that request reliably with the current AI model. Please rephrase or try again.'
      : stripFence(session.restore(result.text));

    const completed =
      intent.list || intent.waiting
        ? appendOmittedPatients(response, rec.trace)
        : { text: response, omitted: 0 };

    response = completed.text;
    const reconciled = reconcileActionClaims(response, rec.trace, {
      actionRequested: intent.plan.intent === 'ACTION' || intent.write,
    });
    response = appendClosestPassage(reconciled.text, rec.trace, dtoMessage);
    const guard = checkGuardrails(response, rec.trace, knownText);
    guard.notes.push(...reconciled.notes);
    if (rawStillBroken) {
      guard.notes.push(
        'The model returned an unusable response (raw tool call).',
      );
    }
    if (completed.omitted) {
      guard.notes.push(
        `${completed.omitted} patient(s) the model left out were added from the system data.`,
      );
    }
    if (guard.notes.length) guard.status = 'WARNING';

    return {
      response,
      result,
      guardrailStatus: guard.status,
      guardrailNotes: guard.notes,
    };
  }

  async generateDocument(
    user: AuthUser,
    model: any,
    dto: DocumentDto,
    session: Awaited<ReturnType<PhiAnonymizerService['createSession']>>,
    rec: RunRecorder,
  ) {
    if (!DOC_ROLES[dto.type].includes(user.role)) {
      throw new ForbiddenException(
        `Role '${user.role}' may not generate ${dto.type} documents`,
      );
    }

    const patient = await this.hospital.getPatientById(dto.patientId);
    const [latestVisit] = await this.visits.listForPatient(patient.id, 1);
    const visit = latestVisit ? toVisitSummary(latestVisit) : null;
    const [labs, vitals, consultations, imaging] = await Promise.all([
      this.hospital.getPatientLabs(patient.id),
      this.records.listVitals(patient.id, 5),
      this.records.listConsultations(patient.id, 3),
      this.records.listImagingStudies(patient.id),
    ]);

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

    return {
      text: session.restore(result.text),
      disclaimer: DISCLAIMER,
      usage: result.usage ?? result.totalUsage,
    };
  }
}
