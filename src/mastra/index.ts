/**
 * STATUS: UNUSED, NOT COMPILED (excluded in tsconfig.build.json). It registered the old single global agent for
 * `mastra dev` Studio. Agents are now created per request (src/ai/agent.ts) so they can be role- and PHI-aware.
 * TODO: to use Mastra Studio again, register a representative agent here built with createHospitalAgent(); else delete.
 */

import 'reflect-metadata';
import { Mastra } from '@mastra/core/mastra';
import { hospitalAgent } from '../ai/agent';
import { emergencyEscalationWorkflow } from '../ai/workflows/emergency-escalation.workflow';

export const mastra = new Mastra({
  agents: {
    hospitalAgent,
  },
  workflows: {
    emergencyEscalationWorkflow,
  },
});
