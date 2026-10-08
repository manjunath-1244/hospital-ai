import { HospitalLifecycleService } from '../../hospital/hospital-lifecycle.service';
import { HospitalService } from '../../hospital/hospital.service';
import { News2Service } from '../../hospital/news2.service';
import { MedicationSafetyService } from '../../hospital/medication-safety.service';
import { ClinicalTool } from './tool-registry';
import { buildSchedulingTools } from './scheduling/scheduling.tools';
import { buildClinicalAssessTools } from './clinical/clinical-assess.tools';
import { VectorRagService } from '../rag/vector-rag.service';

/**
 * Re-exports lifecycle tool builder for backwards compatibility.
 */
export function buildLifecycleTools(d: {
  lifecycle: HospitalLifecycleService;
  hospital: HospitalService;
  news2: News2Service;
  medSafety: MedicationSafetyService;
  rag?: VectorRagService;
}): ClinicalTool[] {
  const sched = buildSchedulingTools({
    hospital: d.hospital,
    lifecycle: d.lifecycle,
    overview: null as any,
  }).filter((t) =>
    [
      'registerOpPatient',
      'recordDoctorConsultation',
      'checkUnconsultedAlerts',
    ].includes(t.name),
  );

  const assess = buildClinicalAssessTools({
    rag: d.rag as any,
    lifecycle: d.lifecycle,
    news2: d.news2,
  }).filter((t) => ['verifyMedicationSafety', 'assessTriage'].includes(t.name));

  return [...sched, ...assess];
}
