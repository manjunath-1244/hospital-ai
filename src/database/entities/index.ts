import { PatientEntity } from './patient.entity';
import { LabResultEntity } from './lab-result.entity';
import { AppointmentEntity } from './appointment.entity';
import { StaffTaskEntity } from './staff-task.entity';
import { UserEntity } from './user.entity';
import { ConsultationEntity } from './consultation.entity';
import { VitalsEntity } from './vitals.entity';
import { ImagingStudyEntity } from './imaging-study.entity';
import { AuditLogEntity } from './audit-log.entity';
import { ChatThreadEntity } from './chat-thread.entity';
import { ChatMessageEntity } from './chat-message.entity';
import { AgentRunEntity } from './agent-run.entity';
import { KnowledgeDocumentEntity } from './knowledge-document.entity';
import { DocumentEmbeddingEntity } from './document-embedding.entity';
import { VisitEntity } from './visit.entity';
import { VisitEventEntity } from './visit-event.entity';
import { DoctorAvailabilityEntity } from './doctor-availability.entity';
import { AgentActionEntity } from './agent-action.entity';

export const ALL_ENTITIES = [
  PatientEntity,
  LabResultEntity,
  AppointmentEntity,
  StaffTaskEntity,
  UserEntity,
  ConsultationEntity,
  VitalsEntity,
  ImagingStudyEntity,
  AuditLogEntity,
  ChatThreadEntity,
  ChatMessageEntity,
  AgentRunEntity,
  KnowledgeDocumentEntity,
  DocumentEmbeddingEntity,
  VisitEntity,
  VisitEventEntity,
  DoctorAvailabilityEntity,
  AgentActionEntity,
];

export {
  DoctorAvailabilityEntity,
  AgentActionEntity,
  VisitEntity,
  VisitEventEntity,
  KnowledgeDocumentEntity,
  ChatThreadEntity,
  ChatMessageEntity,
  AgentRunEntity,
  PatientEntity,
  LabResultEntity,
  AppointmentEntity,
  StaffTaskEntity,
  UserEntity,
  ConsultationEntity,
  VitalsEntity,
  ImagingStudyEntity,
  AuditLogEntity,
};
