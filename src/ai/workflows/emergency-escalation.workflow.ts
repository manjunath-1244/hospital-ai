/**
 * STATUS: UNUSED, NOT COMPILED (excluded in tsconfig.build.json), and its logic is wrong for production
 * (it flags ANY lab above 180 as high risk). Real critical-lab handling lives in src/hospital/lab-rules.ts and raises
 * `alert.critical_lab` over WebSocket today.
 *
 * TODO (if we want a Mastra workflow): model "critical result -> notify on-call doctor -> require human approval ->
 *  escalate after N minutes" as a Mastra workflow with a suspend/resume human-approval step, driven by lab-rules.ts,
 *  and show the pending approvals in the Doctor portal. Otherwise delete this file.
 */

import { Workflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

const inputSchema = z.object({
  patientId: z.string(),
  labValue: z.number(),
  testName: z.string(),
});

const outputSchema = z.object({
  patientId: z.string(),
  requiresPhysicianApproval: z.boolean(),
  status: z.string(),
  summary: z.string(),
});

export const analyzeRiskStep = createStep({
  id: 'analyze-risk-step',
  inputSchema,
  outputSchema,
  execute: async (params: any) => {
    const input = params?.data || params?.input || params || {};
    const labValue = input.labValue || 0;
    const patientId = input.patientId || 'UNKNOWN';
    const testName = input.testName || 'Lab Test';

    const isHigh = labValue > 180;
    return {
      patientId,
      requiresPhysicianApproval: isHigh,
      status: isHigh ? 'FLAGGED_HIGH_RISK' : 'NORMAL',
      summary: `Patient ${patientId} ${testName} value ${labValue} evaluated. High risk status: ${isHigh}.`,
    };
  },
});

export const emergencyEscalationWorkflow = new Workflow({
  id: 'emergency-escalation-workflow',
  inputSchema,
  outputSchema,
  steps: [analyzeRiskStep],
});
