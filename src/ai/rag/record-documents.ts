import type { RagRecord } from './vector-rag.service';
import type { PatientEntity } from '../../database/entities/patient.entity';
import type { ConsultationEntity } from '../../database/entities/consultation.entity';
import type { VitalsEntity } from '../../database/entities/vitals.entity';
import type { ImagingStudyEntity } from '../../database/entities/imaging-study.entity';
import type { VisitEntity } from '../../database/entities/visit.entity';
import { STATUS_LABEL } from '../../hospital/visits/visit-status';
import type { LabResultEntity } from '../../database/entities/lab-result.entity';

/** Pure functions turning clinical rows into RAG documents. Source keys are stable so updates replace, not duplicate. */
export const RecordDocumentBuilder = {
  patient(p: PatientEntity): RagRecord {
    return {
      source: `patient-${p.id}`,
      heading: `Patient ${p.id} chart summary`,
      kind: 'patient_record',
      patientId: p.id,
      text: [
        `## Patient ${p.id} chart summary`,
        `Name: ${p.name}`,
        `Age/Gender: ${p.age} / ${p.gender}`,
        `Blood type: ${p.bloodType}`,
        `Allergies: ${p.allergies.join(', ') || 'none recorded'}`,
        `Current medications: ${p.currentMedications.join(', ') || 'none recorded'}`,
        `Conditions: ${p.conditions.join(', ') || 'none recorded'}`,
      ].join('\n'),
    };
  },

  /** One document per visit: where the patient is in their care and why they came. Re-indexed on every status change. */
  visit(p: PatientEntity, v: VisitEntity): RagRecord {
    return {
      source: `visit-${v.id}`,
      heading: `Visit ${v.id} for ${p.id}`,
      kind: 'patient_record',
      patientId: p.id,
      text: [
        `## Visit ${v.id} for patient ${p.id} (${p.name})`,
        `Status: ${STATUS_LABEL[v.status]} (${v.status})`,
        `Reason for visit: ${v.chiefComplaint ?? 'not recorded'}`,
        `Arrived: ${v.arrivedAt.toISOString()}`,
        `Triage priority: ${v.priority ?? 'not yet triaged'}`,
        `Doctor: ${v.primaryDoctorName ?? 'not yet assigned'}`,
        v.completedAt
          ? `Finished: ${v.completedAt.toISOString()}; outcome ${v.outcome}${v.closeReason ? `; reason: ${v.closeReason}` : ''}`
          : 'This visit is still open.',
      ].join('\n'),
    };
  },

  consultation(p: PatientEntity, c: ConsultationEntity): RagRecord {
    return {
      source: `consultation-${c.id}`,
      heading: `Consultation ${c.id} for ${p.id}`,
      kind: 'patient_record',
      patientId: p.id,
      text: [
        `## Doctor consultation ${c.id} for patient ${p.id} (${p.name})`,
        `Doctor: ${c.doctorName}`,
        `Date: ${c.createdAt.toISOString()}`,
        `Diagnosis: ${c.diagnosis}`,
        `Prescriptions: ${c.prescriptions.join('; ') || 'none'}`,
        `Notes: ${c.notes}`,
      ].join('\n'),
    };
  },

  vitals(p: PatientEntity, v: VitalsEntity): RagRecord {
    return {
      source: `vitals-${v.id}`,
      heading: `Vitals ${v.id} for ${p.id}`,
      kind: 'patient_record',
      patientId: p.id,
      text: [
        `## Vitals and triage for patient ${p.id} (${p.name})`,
        `Recorded: ${v.recordedAt.toISOString()} by ${v.recordedBy}`,
        `Heart rate ${v.heartRate} bpm; systolic BP ${v.bpSystolic} mmHg; SpO2 ${v.spO2}%${v.onSupplementalO2 ? ' on oxygen' : ' on air'};`,
        `Temperature ${v.tempCelsius} C; respiratory rate ${v.respiratoryRate}/min; consciousness ${v.consciousness}.`,
        `NEWS2 score ${v.news2Score} (${v.riskLevel}).`,
      ].join('\n'),
    };
  },

  lab(p: PatientEntity, l: LabResultEntity): RagRecord {
    return {
      source: `lab-${l.id}`,
      heading: `Lab ${l.testName} for ${p.id}`,
      kind: 'patient_record',
      patientId: p.id,
      text: [
        `## Lab result for patient ${p.id} (${p.name})`,
        `Test: ${l.testName}`,
        `Value: ${l.value} ${l.unit} (reference ${l.referenceRange}) status ${l.status}`,
        `Date: ${l.date}`,
      ].join('\n'),
    };
  },

  imaging(p: PatientEntity, s: ImagingStudyEntity): RagRecord {
    return {
      source: `imaging-${s.id}`,
      heading: `${s.modality} study ${s.id} for ${p.id}`,
      kind: 'patient_record',
      patientId: p.id,
      text: [
        `## Imaging study ${s.id} for patient ${p.id} (${p.name})`,
        `Modality: ${s.modality}`,
        `Description: ${s.description ?? 'n/a'}`,
        `Study date: ${s.studyDate ?? 'n/a'}; study UID ${s.studyInstanceUid}`,
        `Radiologist impression: ${s.impression ?? 'not yet reported'}`,
      ].join('\n'),
    };
  },
};
