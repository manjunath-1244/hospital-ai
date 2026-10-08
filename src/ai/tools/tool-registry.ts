import { z } from 'zod';
import type { AuthUser } from '../../security/auth-user';
import type { UserRole } from '../../security/roles.decorator';

export interface Citation {
  file: string;
  heading: string;
}

export interface ToolRunContext {
  user: AuthUser;
}

/**
 * A framework-agnostic tool definition. New capabilities are added by writing another definition and
 * registering it with ClinicalToolsFactory: no agent or factory code changes (open/closed).
 */
export interface ClinicalTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  /** Roles that may use this tool; the agent for any other role never even sees it. */
  roles: UserRole[];
  run(input: any, ctx: ToolRunContext): Promise<unknown>;
  /** Optional: extract source citations from the tool output. */
  citations?(output: any): Citation[];
}

export interface ToolCallRecord {
  name: string;
  args: unknown;
  success: boolean;
  /** True when the server (not the model) ran this retrieval before the model answered. */
  auto?: boolean;
  startedAtMs?: number;
  durationMs?: number;
  error?: string;
}

/** Collects what the agent actually did during one request (shown to the user; used by the guardrail). */
export class ToolTrace {
  readonly calls: ToolCallRecord[] = [];
  readonly citations: Citation[] = [];
  private seen = '';
  /** Raw (unmasked) successful outputs, used by post-answer completeness checks. */
  readonly outputs: Array<{ name: string; output: any }> = [];

  record(call: ToolCallRecord, output: unknown, citations: Citation[] = []) {
    this.calls.push(call);
    if (call.success) this.outputs.push({ name: call.name, output });
    this.seen += JSON.stringify(output) + JSON.stringify(call.args);
    for (const c of citations) {
      if (
        !this.citations.some(
          (x) => x.file === c.file && x.heading === c.heading,
        )
      )
        this.citations.push(c);
    }
  }

  /** True when `text` appears in any tool input/output of this request. */
  saw(text: string): boolean {
    return this.seen.includes(text);
  }
}

export const ALL_STAFF: UserRole[] = [
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'ADMIN',
  'CARE_COORDINATOR',
  'PHARMACIST',
  'RADIOLOGIST',
];
export const CLINICIANS: UserRole[] = ['DOCTOR', 'NURSE', 'ADMIN'];
