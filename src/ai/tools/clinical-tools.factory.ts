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
import { buildHospitalTools } from './hospital.tools';
import { PatientDirectoryService } from '../../hospital/patient-directory.service';
import { SpecialistService } from '../../hospital/specialists/specialist.service';
import { OverviewService } from '../../hospital/overview.service';
import { buildRagTools } from './rag.tools';
import { buildInteropTools } from './fhir-hapi.tools';
import { buildLifecycleTools } from './lifecycle.tools';
import { withTimeout } from '../reliability/resilience';

/**
 * Builds the Mastra tool set for ONE request. All services come from Nest DI (the same instances the REST API uses),
 * tools are filtered by the caller's role, inputs are un-masked and outputs PHI-masked, and every call is traced.
 */
@Injectable()
export class ClinicalToolsFactory {
  private readonly definitions: ClinicalTool[];

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
  ) {
    this.definitions = [
      ...buildHospitalTools({
        hospital,
        summaries,
        directory,
        specialists,
        overview,
        lifecycle,
      }),
      ...buildRagTools(rag),
      ...buildInteropTools(fhir, orthanc),
      ...buildLifecycleTools({ lifecycle, hospital, news2, medSafety }),
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

  build(ctx: { user: AuthUser; phi: PhiSession; trace: ToolTrace }) {
    const tools: Record<string, ReturnType<typeof createTool>> = {};
    for (const def of this.definitions.filter((t) =>
      t.roles.includes(ctx.user.role),
    )) {
      tools[def.name] = createTool({
        id: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (input: any) => {
          const args = ctx.phi.unmaskDeep(input);
          const startedAtMs = Date.now();
          const timeoutMs = Number(process.env.AI_TOOL_TIMEOUT_MS ?? 10_000);
          try {
            const output = await withTimeout(
              () => def.run(args, { user: ctx.user }),
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
