import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HospitalService } from './hospital.service';
import { ClinicalRecordsService } from './clinical-records.service';
import { News2Service } from './news2.service';
import { MedicationSafetyService } from './medication-safety.service';
import { assessLab } from './lab-rules';
import { FhirHapiClient } from '../ai/fhir/fhir-hapi.client';
import { FhirService } from '../ai/fhir/fhir.service';
import { DicomService } from '../ai/dicom/dicom.service';
import { OrthancClient } from '../ai/dicom/orthanc.client';
import { VectorRagService, RagRecord } from '../ai/rag/vector-rag.service';
import { RecordDocumentBuilder } from '../ai/rag/record-documents';
import { HospitalEventsGateway } from '../events/hospital-events.gateway';
import { AuthUser } from '../security/auth-user';
import {
  ConsultationDto,
  ImagingUploadDto,
  LabResultDto,
  RegistrationDto,
  TriageDto,
} from './dto/hospital.dto';
import { PatientEntity } from '../database/entities/patient.entity';
import { SafetyReport } from './hospital.types';

/**
 * Orchestrates clinical workflows. Pattern for every step: (1) commit the authoritative record to Postgres,
 * (2) run best-effort side effects (FHIR sync, RAG indexing, realtime event) that must never lose the record.
 * Side-effect outcomes are reported back (`fhirSynced`, `ragIndexed`) instead of being hidden.
 */
@Injectable()
export class HospitalLifecycleService {
  private readonly logger = new Logger(HospitalLifecycleService.name);

  constructor(
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly news2: News2Service,
    private readonly medSafety: MedicationSafetyService,
    private readonly fhirMapper: FhirService,
    private readonly fhir: FhirHapiClient,
    private readonly dicom: DicomService,
    private readonly orthanc: OrthancClient,
    private readonly rag: VectorRagService,
    private readonly events: HospitalEventsGateway,
  ) {}

  /** Runs a non-critical side effect; returns whether it succeeded. */
  private async sideEffect(
    label: string,
    fn: () => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err: any) {
      this.logger.warn(
        `${label} failed (record already saved): ${err.message}`,
      );
      return false;
    }
  }

  private index(rec: RagRecord) {
    return this.sideEffect(`RAG index ${rec.source}`, () =>
      this.rag.ingest(rec),
    );
  }

  /** Clinical writes are refused for closed sessions; an admin/doctor must reopen first. */
  private assertOpen(patient: PatientEntity): PatientEntity {
    if (patient.consultationStatus === 'CLOSED') {
      throw new ConflictException(
        `Patient ${patient.id} session is closed${patient.closeReason ? ` (${patient.closeReason})` : ''}. Reopen it before recording new data.`,
      );
    }
    return patient;
  }

  async closePatientSession(id: string, user: AuthUser, reason?: string) {
    const p = await this.hospital.closePatient(id, user.userName, reason);
    this.events.emitPatientClosed({
      patientId: p.id,
      patientName: p.name,
      closedBy: user.userName,
    });
    await this.index(RecordDocumentBuilder.patient(p));
    return p;
  }

  async reopenPatientSession(id: string) {
    const p = await this.hospital.reopenPatient(id);
    this.events.emitPatientReopened({ patientId: p.id });
    await this.index(RecordDocumentBuilder.patient(p));
    return p;
  }

  /**
   * Permanent removal (admin only, confirmed by typing the id). The database is authoritative and is cleaned
   * transactionally first; the search index, FHIR record and stored images are then cleaned best-effort and reported.
   */
  async deletePatient(id: string, confirm: string | undefined) {
    const patient = await this.hospital.getPatientById(id);
    if (!confirm || confirm.trim().toUpperCase() !== patient.id) {
      throw new BadRequestException(
        `Confirmation must equal the patient id (${patient.id}).`,
      );
    }
    const { patientId, deleted, orthancInstanceIds } =
      await this.hospital.deletePatientCascade(patient.id);

    let ragChunksRemoved = 0;
    await this.sideEffect('RAG cleanup', async () => {
      ragChunksRemoved = await this.rag.removePatient(patientId);
    });
    const fhirDeleted = await this.sideEffect('FHIR delete', () =>
      this.fhir.deletePatientCascade(patientId),
    );
    for (const inst of orthancInstanceIds) {
      await this.sideEffect('Orthanc delete', () =>
        this.orthanc.deleteInstance(inst),
      );
    }
    this.events.emitPatientDeleted({ patientId });
    this.logger.warn(
      `Patient ${patientId} permanently deleted: ${JSON.stringify(deleted)}`,
    );
    return { success: true, patientId, deleted, fhirDeleted, ragChunksRemoved };
  }

  // 1. RECEPTIONIST: register an outpatient
  async registerOutpatient(dto: RegistrationDto) {
    const patient = await this.hospital.createPatient(dto);

    const fhirSynced = await this.sideEffect(
      'FHIR Patient upsert',
      async () => {
        await this.fhir.upsertPatient(this.fhirMapper.toFhirPatient(patient));
        await this.hospital.markFhirSynced(patient.id);
      },
    );
    const ragIndexed = await this.index(RecordDocumentBuilder.patient(patient));

    const payload = {
      patientId: patient.id,
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      chiefComplaint: patient.chiefComplaint ?? 'General OPD',
      registrationTime: patient.registeredAt.toISOString(),
    };
    this.events.emitPatientRegistered(payload);

    return {
      success: true,
      patientId: patient.id,
      patient: { ...patient, fhirSynced },
      registrationTime: payload.registrationTime,
      status: 'WAITING_FOR_DOCTOR',
      chiefComplaint: payload.chiefComplaint,
      fhirSynced,
      ragIndexed,
    };
  }

  // 2. DOCTOR: consultation + prescriptions, screened by the medication safety shield
  async recordDoctorConsultation(dto: ConsultationDto, user: AuthUser) {
    const patient = this.assertOpen(
      await this.hospital.getPatientById(dto.patientId),
    );
    const safety = await this.screenMedications(patient, dto.prescriptions);

    if (safety.status === 'CRITICAL_BLOCK' && !dto.overrideReason) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message:
          'Prescription blocked by medication safety checks. Resolve the findings or supply an overrideReason.',
        safety,
      });
    }
    // A doctor can only sign as themselves; admins may record on behalf of a named doctor.
    if (
      user.role === 'DOCTOR' &&
      dto.doctorName &&
      dto.doctorName !== user.userName
    ) {
      throw new ForbiddenException(
        'Doctors may only record consultations under their own name',
      );
    }
    const doctorName =
      user.role === 'DOCTOR'
        ? user.userName
        : (dto.doctorName ?? user.userName);

    const consultation = await this.records.saveConsultation(patient, {
      patientId: patient.id,
      doctorId: user.userId,
      doctorName,
      diagnosis: dto.diagnosis,
      prescriptions: dto.prescriptions,
      notes: dto.notes,
      safety,
      overrideReason: dto.overrideReason ?? null,
    });

    await this.index(RecordDocumentBuilder.consultation(patient, consultation));
    await this.index(RecordDocumentBuilder.patient(patient));

    this.events.emitDoctorConsulted({
      patientId: patient.id,
      patientName: patient.name,
      doctorName,
      diagnosis: dto.diagnosis,
      consultationTime: consultation.createdAt.toISOString(),
    });

    return {
      success: true,
      consultationId: consultation.id,
      patientId: patient.id,
      patientName: patient.name,
      doctorName,
      diagnosis: consultation.diagnosis,
      prescriptions: consultation.prescriptions,
      notes: consultation.notes,
      consultationTime: consultation.createdAt.toISOString(),
      status: 'CONSULTATION_COMPLETED',
      safety,
    };
  }

  /** Screens a medication list against the patient's chart and latest creatinine. */
  async screenMedications(
    patient: PatientEntity,
    medications: string[],
  ): Promise<SafetyReport> {
    const labs = await this.hospital.getPatientLabs(patient.id);
    const cr = labs.find((l) => /creatinine/i.test(l.testName));
    const mgDl = cr
      ? this.medSafety.creatinineToMgDl(parseFloat(cr.value), cr.unit)
      : undefined;
    return this.medSafety.audit(
      patient,
      medications,
      Number.isFinite(mgDl) ? mgDl : undefined,
    );
  }

  // 3a. LAB: persist a result, classify it, alert on critical values
  async recordLabResult(dto: LabResultDto, user: AuthUser) {
    const patient = this.assertOpen(
      await this.hospital.getPatientById(dto.patientId),
    );
    const { status, criticalLimit } = assessLab(
      dto.testName,
      dto.value,
      dto.unit,
      dto.referenceRange,
    );

    const lab = await this.hospital.addLab({
      patientId: patient.id,
      testName: dto.testName,
      value: dto.value,
      unit: dto.unit,
      referenceRange: dto.referenceRange ?? 'n/a',
      status,
      date: new Date().toISOString().slice(0, 10),
      recordedBy: user.userName,
    });

    await this.index(RecordDocumentBuilder.lab(patient, lab));
    await this.sideEffect('FHIR Observation upsert', () =>
      this.fhir.upsertObservation(this.fhirMapper.toFhirObservation(lab)),
    );

    const isCritical = status === 'CRITICAL';
    if (isCritical) {
      this.events.emitCriticalLabAlert({
        patientId: patient.id,
        patientName: patient.name,
        testName: dto.testName,
        value: dto.value,
        unit: dto.unit,
        severity: 'CRITICAL_RED_ALERT',
        panicLimit: criticalLimit,
        timestamp: new Date().toISOString(),
      });
    }
    return { success: true, lab, isCritical };
  }

  // 3b. RADIOLOGY: real DICOM upload -> parse -> Orthanc PACS -> FHIR ImagingStudy -> RAG
  async recordImagingStudy(
    dto: ImagingUploadDto,
    file: Buffer,
    user: AuthUser,
  ) {
    const patient = this.assertOpen(
      await this.hospital.getPatientById(dto.patientId),
    );
    const meta = this.dicom.parseDicomBuffer(file); // throws 400 on invalid DICOM

    let orthancInstanceId: string | null = null;
    const orthancStored = await this.sideEffect('Orthanc upload', async () => {
      orthancInstanceId = await this.orthanc.uploadInstance(file);
    });

    const study = await this.records.addImagingStudy({
      patientId: patient.id,
      studyInstanceUid: meta.studyInstanceUid,
      seriesInstanceUid: meta.seriesInstanceUid ?? null,
      modality: meta.modality,
      description: meta.studyDescription ?? null,
      impression: dto.impression ?? null,
      rows: meta.rows ?? null,
      columns: meta.columns ?? null,
      studyDate: meta.studyDate ?? null,
      orthancInstanceId,
      fhirId: null,
      uploadedBy: user.userName,
    });

    const fhirSynced = await this.sideEffect(
      'FHIR ImagingStudy upsert',
      async () => {
        await this.fhir.upsertImagingStudy(
          this.fhirMapper.toFhirImagingStudy(study),
        );
        await this.records.updateImagingStudy(study.id, { fhirId: study.id });
        study.fhirId = study.id;
      },
    );
    await this.index(RecordDocumentBuilder.imaging(patient, study));

    this.events.emitDicomUploaded({
      patientId: patient.id,
      studyId: study.id,
      modality: study.modality,
      description: study.description,
    });
    return {
      success: true,
      study: this.studyView(study),
      fhirSynced,
      orthancStored,
    };
  }

  studyView<T extends { orthancInstanceId: string | null }>(s: T) {
    const { orthancInstanceId, ...rest } = s;
    return { ...rest, hasPreview: !!orthancInstanceId };
  }

  // 4. NURSE: triage + NEWS2 + SIRS + ESI suggestion
  async recordTriageAndVitals(dto: TriageDto, user: AuthUser) {
    const patient = this.assertOpen(
      await this.hospital.getPatientById(dto.patientId),
    );
    const assessment = this.news2.assess(dto);

    const vitals = await this.records.addVitals({
      patientId: patient.id,
      heartRate: dto.heartRate,
      bpSystolic: dto.bpSystolic,
      spO2: dto.spO2,
      tempCelsius: dto.tempCelsius,
      respiratoryRate: dto.respiratoryRate,
      painScore: dto.painScore ?? null,
      consciousness: dto.consciousness,
      onSupplementalO2: dto.onSupplementalO2,
      news2Score: assessment.score,
      riskLevel: assessment.riskLevel,
      recordedBy: user.userName,
    });

    await this.index(RecordDocumentBuilder.vitals(patient, vitals));

    if (assessment.escalate) {
      this.events.emitNews2Alert({
        patientId: patient.id,
        patientName: patient.name,
        news2Score: assessment.score,
        riskLevel: assessment.riskLevel,
        timestamp: vitals.recordedAt.toISOString(),
      });
    }

    return {
      success: true,
      vitalsId: vitals.id,
      patientId: patient.id,
      news2Score: assessment.score,
      riskLevel: assessment.riskLevel,
      breakdown: assessment.breakdown,
      sirs: assessment.sirs,
      suggestedEsiLevel: assessment.suggestedEsiLevel,
      rationale: assessment.rationale,
    };
  }

  // Ward board: latest vitals per patient, sickest first
  async wardBoard() {
    const latest = await this.records.latestVitalsPerPatient();
    const patients = new Map(
      (await this.hospital.listPatients({ limit: 200 })).items.map((p) => [
        p.id,
        p,
      ]),
    );
    return latest
      .filter((v) => patients.has(v.patientId))
      .map((v) => {
        const p = patients.get(v.patientId)!;
        return {
          patientId: p.id,
          name: p.name,
          age: p.age,
          gender: p.gender,
          latest: {
            news2Score: v.news2Score,
            riskLevel: v.riskLevel,
            heartRate: v.heartRate,
            bpSystolic: v.bpSystolic,
            spO2: v.spO2,
            tempCelsius: v.tempCelsius,
            respiratoryRate: v.respiratoryRate,
            recordedAt: v.recordedAt.toISOString(),
          },
        };
      })
      .sort((a, b) => b.latest.news2Score - a.latest.news2Score);
  }

  // Waiting-room queue with computed wait times
  async queue() {
    const waitAlertMinutes = Number(process.env.WAIT_ALERT_MINUTES ?? 30);
    const waiting = await this.hospital.findWaiting();
    return {
      waitAlertMinutes,
      items: waiting.map((p) => ({
        patientId: p.id,
        name: p.name,
        age: p.age,
        gender: p.gender,
        chiefComplaint: p.chiefComplaint ?? 'General OPD',
        registeredAt: p.registeredAt.toISOString(),
        waitMinutes: Math.floor(
          (Date.now() - p.registeredAt.getTime()) / 60_000,
        ),
        status: 'WAITING_FOR_DOCTOR',
      })),
    };
  }

  /** Read-only: patients waiting longer than the policy limit. Broadcasting is done by QueueMonitorService. */
  async checkUnconsultedPatientAlerts() {
    const limit = Number(process.env.WAIT_ALERT_MINUTES ?? 30);
    const late = await this.hospital.findWaitingLongerThan(limit);
    const alerts = late.map((p) => ({
      patientId: p.id,
      name: p.name,
      waitMinutes: Math.floor((Date.now() - p.registeredAt.getTime()) / 60_000),
    }));
    return { unconsultedAlertsCount: alerts.length, alerts };
  }

  // Pharmacy
  async pharmacyAudit(patientId: string, medications: string[]) {
    const patient = await this.hospital.getPatientById(patientId);
    return this.screenMedications(patient, medications);
  }

  async pharmacyQueue() {
    const consultations = await this.records.recentConsultations(50);
    const cache = new Map<string, PatientEntity>();
    const out: unknown[] = [];
    for (const c of consultations) {
      if (!c.prescriptions.length) continue;
      let p = cache.get(c.patientId);
      if (!p) {
        p = await this.hospital.getPatientById(c.patientId);
        cache.set(c.patientId, p);
      }
      out.push({
        consultationId: c.id,
        patientId: c.patientId,
        patientName: p.name,
        doctorName: c.doctorName,
        prescriptions: c.prescriptions,
        createdAt: c.createdAt.toISOString(),
        safety: c.safety,
      });
    }
    return out;
  }
}
