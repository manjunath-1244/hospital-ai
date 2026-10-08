export type BackendRole =
  | 'DOCTOR'
  | 'NURSE'
  | 'RECEPTIONIST'
  | 'ADMIN'
  | 'CARE_COORDINATOR'
  | 'PHARMACIST'
  | 'RADIOLOGIST';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: BackendRole;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface Patient {
  id: string;
  name: string;
  age: number;
  gender: string;
  dob: string;
  phone: string;
  bloodType: string;
  allergies: string[];
  currentMedications: string[];
  conditions: string[];
  chiefComplaint: string;
  consultationStatus: 'WAITING' | 'SEEN' | 'CLOSED';
  registeredAt: string;
  consultedAt: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
  closeReason?: string | null;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  filename: string;
  origin: 'builtin' | 'uploaded';
  sizeBytes: number;
  chunkCount: number;
  uploadedBy: string | null;
  createdAt: string | null;
}

export interface KnowledgeReindexResult {
  success: boolean;
  documents: number;
  chunks: number;
  patients: number;
}

export interface PatientDeleteResult {
  success: boolean;
  patientId: string;
  deleted: { labs: number; vitals: number; consultations: number; imaging: number; appointments: number; tasks: number };
  fhirDeleted: boolean;
  ragChunksRemoved: number;
}

export interface PatientList {
  items: Patient[];
  total: number;
}

export interface LabResult {
  id: string;
  patientId: string;
  testName: string;
  value: string | number;
  unit: string;
  referenceRange: string;
  status: 'NORMAL' | 'ABNORMAL' | 'CRITICAL';
  date: string;
}

export interface MedicationsResponse {
  medications: string[];
  allergies: string[];
}

export type Consciousness = 'ALERT' | 'CONFUSION' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE';
export type RiskLevel = 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH';

export interface Vitals {
  id: string;
  patientId: string;
  heartRate: number;
  bpSystolic: number;
  spO2: number;
  tempCelsius: number;
  respiratoryRate: number;
  painScore: number | null;
  consciousness: Consciousness;
  onSupplementalO2: boolean;
  news2Score: number;
  riskLevel: RiskLevel;
  recordedBy: string;
  recordedAt: string;
}

export interface ImagingStudy {
  id: string;
  patientId: string;
  studyInstanceUid: string;
  modality: string;
  description: string;
  impression: string | null;
  rows: number | null;
  columns: number | null;
  studyDate: string | null;
  uploadedBy: string;
  createdAt: string;
  hasPreview: boolean;
}

export interface RegisterOpPayload {
  name: string;
  age: number;
  gender: string;
  phone: string;
  bloodType: string;
  chiefComplaint?: string;
}

export interface RegisterOpResponse {
  success: boolean;
  patientId: string;
  patient: Patient;
  registrationTime: string;
  status: string;
  chiefComplaint: string;
  fhirSynced: boolean;
  ragIndexed: boolean;
}

export interface QueueItem {
  patientId: string;
  name: string;
  age: number;
  gender: string;
  chiefComplaint: string;
  registeredAt: string;
  waitMinutes: number;
  status: string;
}

export interface QueueResponse {
  waitAlertMinutes: number;
  items: QueueItem[];
}

export type SafetyStatus = 'SAFE' | 'WARNING' | 'CRITICAL_BLOCK';

export interface SafetyFinding {
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  type: string;
  drug: string;
  message: string;
}

export interface Safety {
  status: SafetyStatus;
  findings: SafetyFinding[];
}

export interface ConsultationPayload {
  patientId: string;
  doctorName?: string;
  diagnosis: string;
  prescriptions: string[];
  notes: string;
  overrideReason?: string;
}

export interface ConsultationResponse {
  success: boolean;
  consultationId: string;
  patientId: string;
  patientName: string;
  diagnosis: string;
  prescriptions: string[];
  notes: string;
  consultationTime: string;
  status: string;
  safety: Safety;
}

export interface LabResultPayload {
  patientId: string;
  testName: string;
  value: string;
  unit: string;
  referenceRange?: string;
}

export interface LabResultResponse {
  success: boolean;
  lab: LabResult;
  isCritical: boolean;
}

export interface ImagingUploadResponse {
  success: boolean;
  study: ImagingStudy;
  fhirSynced: boolean;
  orthancStored: boolean;
}

export interface TriagePayload {
  patientId: string;
  heartRate: number;
  bpSystolic: number;
  spO2: number;
  tempCelsius: number;
  respiratoryRate: number;
  painScore?: number;
  consciousness: Consciousness;
  onSupplementalO2: boolean;
  spo2Scale2?: boolean;
}

export interface TriageResponse {
  success: boolean;
  vitalsId: string;
  patientId: string;
  news2Score: number;
  riskLevel: RiskLevel;
  breakdown: {
    respiratoryRate: number;
    spO2: number;
    supplementalO2: number;
    systolicBp: number;
    heartRate: number;
    consciousness: number;
    temperature: number;
  };
  sirs: { count: number; criteria: string[]; positive: boolean };
  suggestedEsiLevel: 1 | 2 | 3 | 4 | 5;
  rationale: string;
}

export interface WardEntry {
  patientId: string;
  name: string;
  age: number;
  gender: string;
  latest: {
    news2Score: number;
    riskLevel: RiskLevel;
    heartRate: number;
    bpSystolic: number;
    spO2: number;
    tempCelsius: number;
    respiratoryRate: number;
    recordedAt: string;
  };
}

export interface PharmacyQueueItem {
  consultationId: string;
  patientId: string;
  patientName: string;
  doctorName: string;
  prescriptions: string[];
  createdAt: string;
  safety: Safety;
}

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface TaskPayload {
  title: string;
  assignedTo: string;
  patientId?: string;
  priority: TaskPriority;
}

export interface ChatToolCall {
  name: string;
  args?: unknown;
  success: boolean;
  durationMs?: number;
}

export interface ChatMemoryInfo {
  summarized: boolean;
  messagesInContext: number;
}

export interface ChatResponse {
  success: boolean;
  response?: string;
  threadId?: string;
  traceId?: string;
  toolCalls?: ChatToolCall[];
  citations?: { file: string; heading?: string }[];
  guardrailStatus?: 'VERIFIED_SAFE' | 'WARNING';
  guardrailNotes?: string[];
  hipaaShieldActive?: boolean;
  memory?: ChatMemoryInfo;
  error?: string;
}

export interface ChatThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
  activePatientId: string | null;
}

export interface ChatThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatThreadDetail {
  id: string;
  title: string;
  summary: string | null;
  messages: ChatThreadMessage[];
}

export type DriftSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AgentMetricWindow {
  hours: number;
  runs: number;
  errorRate: number;
  guardrailWarnRate: number;
  toolFailureRate: number;
  noToolRate: number;
  avgToolCalls: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgTokens: number;
  topTools: { name: string; count: number }[];
}

export interface AgentDriftItem {
  metric: string;
  current: number;
  baseline: number;
  severity: DriftSeverity;
  message: string;
}

export interface AgentMetrics {
  window: AgentMetricWindow;
  baseline: AgentMetricWindow;
  drift: AgentDriftItem[];
  breaker: { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; consecutiveFailures: number };
}

export interface AgentRunSummary {
  id: string;
  at: string;
  userRole: string;
  model: string;
  status: 'OK' | 'ERROR';
  durationMs: number;
  guardrailStatus: string;
  toolCalls: number;
  retries: number;
  error: string | null;
}

export interface AgentRunStep {
  type: 'llm' | 'tool' | 'memory';
  name: string;
  startOffsetMs: number;
  durationMs: number;
  success: boolean;
  error?: string;
  args?: unknown;
}

export interface AgentRunDetail extends AgentRunSummary {
  guardrailNotes: string[];
  threadId: string | null;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  steps: AgentRunStep[];
}

export type DocumentType = 'SBAR' | 'PRIOR_AUTH' | 'DISCHARGE_TRANSLATION';

export interface DocumentResponse {
  success: boolean;
  type: DocumentType;
  content: string;
  disclaimer: string;
}

export interface HealthResponse {
  checkedAt: string;
  services: { name: string; status: 'UP' | 'DOWN'; latencyMs: number; details: string }[];
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  role: string;
  method: string;
  path: string;
  patientId: string | null;
  statusCode: number;
  at: string;
}
