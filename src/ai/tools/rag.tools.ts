import { VectorRagService } from '../rag/vector-rag.service';
import { ClinicalTool } from './tool-registry';
import { buildInteropTools } from './interop/interop.tools';
import { buildClinicalAssessTools } from './clinical/clinical-assess.tools';

/**
 * Re-exports RAG tool builder for backwards compatibility.
 */
export function buildRagTools(rag: VectorRagService): ClinicalTool[] {
  const policyTool = buildInteropTools(null as any, null as any, rag).find(
    (t) => t.name === 'searchHospitalPolicies',
  )!;
  const recordsTool = buildClinicalAssessTools({
    rag,
    lifecycle: null as any,
    news2: null as any,
  }).find((t) => t.name === 'searchClinicalRecords')!;

  return [policyTool, recordsTool].filter(Boolean);
}
