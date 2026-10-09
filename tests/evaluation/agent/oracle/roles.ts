/**
 * The ROLE POLICY the agent must obey, written as a specification (who may see/do what), independent of the code that
 * enforces it. The scenario generator turns every row into scenarios; the evaluation then checks the running system
 * against this table. Sources: the documented role matrix (docs/PROJECT_GUIDE.md section 1.3 and 4.5),
 * `src/ai/tools/tool-roles.spec.ts` and `tests/workflow/roles-matrix.mjs`. Change a row here only when the PRODUCT
 * policy changes, never to make a failing scenario pass.
 */
export const ROLES = ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'RADIOLOGIST', 'PHARMACIST', 'CARE_COORDINATOR', 'SPECIALIST', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_ABBR: Record<Role, string> = {
  DOCTOR: 'DOC',
  NURSE: 'NUR',
  RECEPTIONIST: 'REC',
  RADIOLOGIST: 'RAD',
  PHARMACIST: 'PHM',
  CARE_COORDINATOR: 'CCO',
  SPECIALIST: 'SPC',
  ADMIN: 'ADM',
};

const R = (...r: Role[]) => r;
const ALL: Role[] = [...ROLES];

/** Chart sections each role may read (minimum necessary). A SPECIALIST additionally needs a referral, see below. */
export type Section = 'conditions' | 'allergies' | 'medications' | 'labs' | 'vitals' | 'imaging' | 'appointments';
export const SECTION_ROLES: Record<Section, Role[]> = {
  conditions: R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'RADIOLOGIST', 'CARE_COORDINATOR', 'SPECIALIST'),
  allergies: R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'RADIOLOGIST', 'SPECIALIST'),
  medications: R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'CARE_COORDINATOR', 'SPECIALIST'),
  labs: R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'RADIOLOGIST', 'SPECIALIST'),
  vitals: R('DOCTOR', 'NURSE', 'ADMIN', 'SPECIALIST'),
  imaging: R('DOCTOR', 'NURSE', 'ADMIN', 'RADIOLOGIST', 'SPECIALIST'),
  appointments: R('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR'),
};
/** The computed medication-safety alerts travel with the chart for these roles only. */
export const SAFETY_ALERT_ROLES: Role[] = R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'SPECIALIST');

/**
 * Seeded patients P1001-P1003 have no referral to any specialist, and a specialist may open a chart ONLY through a
 * referral that is theirs. So for these patients a SPECIALIST is always refused.
 */
export const SPECIALIST_NEEDS_REFERRAL = true;

/** Which roles have each agent tool (the model is never offered the others). */
export const TOOL_ROLES: Record<string, Role[]> = {
  searchPatients: R('DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN', 'PHARMACIST', 'RADIOLOGIST', 'CARE_COORDINATOR'),
  getPatientSummary: ALL,
  getCurrentVisit: ALL,
  getHospitalOverview: R('DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN', 'CARE_COORDINATOR'),
  getAppointmentsAndTasks: R('DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN', 'CARE_COORDINATOR'),
  getStaffSummary: ALL,
  findSpecialists: ALL,
  getSpecialistAvailability: ALL,
  searchHospitalPolicies: ALL,
  searchClinicalGuidelines: ALL,
  searchClinicalRecords: R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST'),
  getLabs: R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'RADIOLOGIST', 'SPECIALIST'),
  getVitalsHistory: R('DOCTOR', 'NURSE', 'ADMIN', 'SPECIALIST'),
  getMedications: R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'CARE_COORDINATOR', 'SPECIALIST'),
  getAllergies: R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'RADIOLOGIST', 'SPECIALIST'),
  verifyMedicationSafety: R('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST'),
  assessTriage: R('DOCTOR', 'NURSE', 'ADMIN'),
  checkUnconsultedAlerts: R('DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'),
  reviewReferralNeed: R('DOCTOR', 'NURSE', 'ADMIN'),
  proposeReferral: R('DOCTOR', 'NURSE', 'ADMIN'),
  proposeLabOrder: R('DOCTOR', 'NURSE', 'ADMIN'),
  proposeAppointment: R('DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'),
  proposeTask: R('DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'),
  proposeNotification: R('DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'),
  proposeRegistration: R('RECEPTIONIST', 'ADMIN'),
  proposeConsultation: R('DOCTOR', 'ADMIN'),
  proposeFollowUp: R('DOCTOR', 'NURSE', 'CARE_COORDINATOR', 'ADMIN'),
};

/** Tools whose arguments name a patient: a specialist is refused them without a referral. */
export const PATIENT_ARG_TOOLS = new Set(['getLabs', 'getVitalsHistory', 'getMedications', 'getAllergies', 'getCurrentVisit', 'getPatientSummary', 'reviewReferralNeed', 'verifyMedicationSafety']);

export const can = (role: Role, tool: string) => (TOOL_ROLES[tool] ?? []).includes(role);
export const canSee = (role: Role, section: Section) => SECTION_ROLES[section].includes(role) && !(role === 'SPECIALIST' && SPECIALIST_NEEDS_REFERRAL);
