import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { HospitalService } from '../../hospital/hospital.service';
import { PatientSummaryService } from '../../hospital/patient-summary.service';
import { HospitalLifecycleService } from '../../hospital/hospital-lifecycle.service';
import { News2Service } from '../../hospital/news2.service';
import { MedicationSafetyService } from '../../hospital/medication-safety.service';
import { VectorRagService } from '../rag/vector-rag.service';
import { FhirHapiClient } from '../fhir/fhir-hapi.client';
import { OrthancClient } from '../dicom/orthanc.client';
import { PhiSession } from '../security/phi-anonymizer.service';
import type { AuthUser } from '../../security/auth-user';
import { ClinicalTool, ToolTrace } from './tool-registry';
import type { AgentContext } from '../context/agent-context';
import { applyToolPolicy, bindingViolation } from '../context/tool-policy';
import { PatientDirectoryService } from '../../hospital/patient-directory.service';
import { SpecialistService } from '../../hospital/specialists/specialist.service';
import { OverviewService } from '../../hospital/overview.service';
import { VisitsService } from '../../hospital/visits/visits.service';
import { ClinicalRecordsService } from '../../hospital/clinical-records.service';

import { buildPatientTools } from './patient/patient.tools';
import { buildClinicalReadTools } from './clinical/clinical-read.tools';
import { buildClinicalAssessTools } from './clinical/clinical-assess.tools';
import { buildSpecialistTools } from './specialist/specialist.tools';
import { buildSchedulingTools } from './scheduling/scheduling.tools';
import { ReferralRecommendationService } from '../../hospital/referrals/referral-recommendation.service';
import { ActionProposalService } from '../actions/action-proposal.service';
import { buildProposeTools, type ProposalSaver } from './actions/propose.tools';
import { buildInteropTools } from './interop/interop.tools';
import { withTimeout } from '../reliability/resilience';

/**
 * Builds the Mastra tool set for ONE request. All services come from Nest DI (the same instances the REST API uses),
 * tools are filtered by the caller's role, inputs are un-masked and outputs PHI-masked, and every call is traced.
 */
@Injectable()
export class ClinicalToolsFactory {
  private readonly definitions: ClinicalTool[];
  private readonly hospital: HospitalService;

  constructor(
    hospital: HospitalService,
    summaries: PatientSummaryService,
    directory: PatientDirectoryService,
    specialists: SpecialistService,
    overview: OverviewService,
    lifecycle: HospitalLifecycleService,
    news2: News2Service,
    medSafety: MedicationSafetyService,
    rag: VectorRagService,
    fhir: FhirHapiClient,
    orthanc: OrthancClient,
    visits: VisitsService,
    records: ClinicalRecordsService,
    proposals: ActionProposalService,
    referralRecommendations: ReferralRecommendationService,
  ) {
    this.hospital = hospital;
    // Proposals are saved for human approval, linked to the patient's open visit, conversation and trace.
    const saveProposal: ProposalSaver = async ({ type, payload }, run) => {
      const pid = payload.patientId as string | undefined;
      const visit = pid ? await visits.getActive(pid) : null;
      return proposals.propose(
        {
          type,
          payload: { ...payload, ...(visit ? { visitId: visit.id } : {}) },
          patientId: pid ?? undefined,
          visitId: visit?.id,
          threadId: run.threadId ?? undefined,
          traceId: run.traceId,
        },
        run.user,
      );
    };
    this.definitions = [
      ...buildPatientTools({ directory, summaries }),
      ...buildClinicalReadTools({
        hospital,
        records,
        visits,
        medSafety,
        rag,
      }),
      ...buildClinicalAssessTools({ rag, lifecycle, news2 }),
      ...buildSpecialistTools({
        specialists,
        referrals: referralRecommendations,
      }),
      ...buildSchedulingTools({ hospital, lifecycle, overview }),
      ...buildProposeTools(saveProposal),
      ...buildInteropTools(fhir, orthanc, rag),
    ];
  }

  /**
   * Server-side retrieval: runs a tool directly (same role check, timeout and tracing as when the model calls it).
   * Returns null when the role may not use the tool or it fails; the failure is traced, never thrown into the answer.
   */
  async runDirect(
    name: string,
    args: unknown,
    ctx: { user: AuthUser; trace: ToolTrace },
    recordIf: (output: any) => boolean = () => true,
  ): Promise<any | null> {
    const def = this.definitions.find(
      (t) => t.name === name && t.roles.includes(ctx.user.role),
    );
    if (!def) return null;
    const startedAtMs = Date.now();
    try {
      const parsed = def.inputSchema.parse(args);
      const output = await withTimeout(
        () => def.run(parsed, { user: ctx.user }),
        Number(process.env.AI_TOOL_TIMEOUT_MS ?? 10_000),
        `tool ${name}`,
      );
      if (!recordIf(output)) return output; // exploratory lookup that turned out irrelevant: leave no trace
      ctx.trace.record(
        {
          name,
          args: parsed,
          success: true,
          auto: true,
          startedAtMs,
          durationMs: Date.now() - startedAtMs,
        },
        output,
        def.citations?.(output),
      );
      return output;
    } catch (err: any) {
      ctx.trace.record(
        {
          name,
          args,
          success: false,
          auto: true,
          startedAtMs,
          durationMs: Date.now() - startedAtMs,
          error: err?.message,
        },
        { success: false, error: err?.message },
      );
      return null;
    }
  }

  toolNamesFor(user: AuthUser): string[] {
    return this.definitions
      .filter((t) => t.roles.includes(user.role))
      .map((t) => t.name);
  }

  /**
   * Small models sometimes put the patient's NAME where an id belongs. Resolve it to the id when it names exactly one
   * patient; otherwise leave it, and the context binding refuses it.
   */
  private async resolvePatientArg<T>(args: T): Promise<T> {
    const raw = (args as { patientId?: unknown } | null)?.patientId;
    if (typeof raw !== 'string' || !raw.trim()) return args;
    try {
      return {
        ...args,
        patientId: (await this.hospital.getPatientById(raw)).id,
      };
    } catch {
      const named = await this.hospital.findMentioned(raw);
      return named.length === 1 ? { ...args, patientId: named[0].id } : args;
    }
  }

  /** Adds the permissions (tools visible for this role in this visit state) to a freshly built context. */
  applyPolicy(base: Omit<AgentContext, 'permissions'>): AgentContext {
    return applyToolPolicy(base, this.definitions);
  }

  build(ctx: {
    user: AuthUser;
    phi: PhiSession;
    trace: ToolTrace;
    context: AgentContext;
    traceId?: string;
  }) {
    const tools: Record<string, ReturnType<typeof createTool>> = {};
    for (const def of this.definitions.filter((t) =>
      ctx.context.permissions.tools.includes(t.name),
    )) {
      tools[def.name] = createTool({
        id: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (input: any) => {
          const args = await this.resolvePatientArg(ctx.phi.unmaskDeep(input));
          const startedAtMs = Date.now();
          const timeoutMs = Number(process.env.AI_TOOL_TIMEOUT_MS ?? 10_000);
          const violation = bindingViolation(def, args, ctx.context);
          if (violation) {
            const output = { success: false, error: violation };
            ctx.trace.record(
              {
                name: def.name,
                args,
                success: false,
                startedAtMs,
                durationMs: 0,
                error: violation,
              },
              output,
            );
            return ctx.phi.maskDeep(output);
          }
          try {
            const output = await withTimeout(
              () =>
                def.run(args, {
                  user: ctx.user,
                  threadId: ctx.context.conversation.threadId,
                  traceId: ctx.traceId,
                }),
              timeoutMs,
              `tool ${def.name}`,
            );
            const durationMs = Date.now() - startedAtMs;
            ctx.trace.record(
              { name: def.name, args, success: true, startedAtMs, durationMs },
              output,
              def.citations?.(output),
            );
            return ctx.phi.maskDeep(output);
          } catch (err: any) {
            const body = err?.response ?? {};
            const message = err?.message ?? 'Tool failed';
            const output = {
              success: false,
              error: message,
              ...(body.safety ? { safety: body.safety } : {}),
            };
            ctx.trace.record(
              {
                name: def.name,
                args,
                success: false,
                startedAtMs,
                durationMs: Date.now() - startedAtMs,
                error: message,
              },
              output,
            );
            return ctx.phi.maskDeep(output);
          }
        },
      } as any);
    }
    return tools;
  }
}
