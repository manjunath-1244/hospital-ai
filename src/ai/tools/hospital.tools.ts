import { HospitalService } from '../../hospital/hospital.service';
import { PatientDirectoryService } from '../../hospital/patient-directory.service';
import { SpecialistService } from '../../hospital/specialists/specialist.service';
import { OverviewService } from '../../hospital/overview.service';
import { HospitalLifecycleService } from '../../hospital/hospital-lifecycle.service';
import { PatientSummaryService } from '../../hospital/patient-summary.service';
import { ClinicalTool } from './tool-registry';
import { buildPatientTools } from './patient/patient.tools';
import { buildSpecialistTools } from './specialist/specialist.tools';
import { buildSchedulingTools } from './scheduling/scheduling.tools';

/**
 * Re-exports hospital tool builder for backwards compatibility.
 * Delegates to organized domain tool packages under src/ai/tools/.
 */
export function buildHospitalTools(d: {
  hospital: HospitalService;
  summaries: PatientSummaryService;
  directory: PatientDirectoryService;
  overview: OverviewService;
  lifecycle: HospitalLifecycleService;
  specialists: SpecialistService;
}): ClinicalTool[] {
  return [
    ...buildPatientTools({ directory: d.directory, summaries: d.summaries }),
    ...buildSpecialistTools({ specialists: d.specialists }),
    ...buildSchedulingTools({
      hospital: d.hospital,
      lifecycle: d.lifecycle,
      overview: d.overview,
    }),
  ];
}
