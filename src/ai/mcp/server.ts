/**
 * STATUS: UNUSED STUB, NOT COMPILED (excluded in tsconfig.build.json) and it imports tools that no longer exist.
 * It was an early idea: expose the hospital tools to other AI clients through the Model Context Protocol (MCP).
 *
 * TODO (if we want it): build it on the current `ClinicalToolsFactory` (src/ai/tools) using Mastra's MCP server
 *  (`@mastra/mcp`), authenticate callers with the same JWT and role filtering, and apply the PHI masking layer
 *  (`PhiSession`) to every tool result. Otherwise delete this file.
 */

import {
  getPatientDetailsTool,
  getPatientLabsTool,
  bookAppointmentTool,
} from '../tools/hospital.tools';

export class HospitalMcpAdapter {
  static getTools() {
    return [getPatientDetailsTool, getPatientLabsTool, bookAppointmentTool];
  }

  static getCapabilities() {
    return {
      name: 'Hospital Core MCP Server',
      version: '1.0.0',
      tools: this.getTools().map((t) => t.id),
    };
  }
}
