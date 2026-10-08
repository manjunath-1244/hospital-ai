import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HospitalService } from './hospital.service';
import { ClinicalRecordsService } from './clinical-records.service';
import { News2Service } from './news2.service';
import { MedicationSafetyService } from './medication-safety.service';
import { PostCommitService } from './post-commit.service';
import { SpecialistService } from './specialists/specialist.service';
import { slotKey } from './specialists/availability';
import { PatientDirectoryService } from './patient-directory.service';
import { VisitsService } from './visits/visits.service';
import { toVisitSummary } from './visits/visit-summary';
import { ACTIVE_STATUSES, WAITING_STATUSES } from './visits/visit-status';
import { manualTransitionsFor } from './visits/visit-transitions';
import { rankMatches } from './patient-matching';
import { assessLab } from './lab-rules';
import { FhirHapiClient } from '../ai/fhir/fhir-hapi.client';
import { FhirService } from '../ai/fhir/fhir.service';
import { DicomService } from '../ai/dicom/dicom.service';
import { OrthancClient } from '../ai/dicom/orthanc.client';
import { VectorRagService } from '../ai/rag/vector-rag.service';
import { RecordDocumentBuilder } from '../ai/rag/record-documents';
import { HospitalEventsGateway } from '../events/hospital-events.gateway';
import { AuthUser } from '../security/auth-user';
import {
  AppointmentDto,
  ConsultationDto,
  ImagingUploadDto,
  LabResultDto,
  RegistrationDto,
  StartVisitDto,
  TaskDto,
  TriageDto,
  VisitTransitionDto,
} from './dto/hospital.dto';
import { PatientEntity } from '../database/entities/patient.entity';
import { VisitEntity } from '../database/entities/visit.entity';
import { SafetyReport } from './hospital.types';

/**
 * Orchestrates clinical workflows. Pattern for every step: (1) commit the authoritative record to Postgres,
 * (2) run best-effort side effects (FHIR sync, RAG indexing, realtime event) that must never lose the record.
 * Side-effect outcomes are reported back (`fhirSynced`, `ragIndexed`) instead of being hidden.
 *
 * Every clinical record belongs to a VISIT. Writes go to the patient's open visit (409 if there is none), and the
 * visit status only ever changes through `VisitsService.transition`.
 */
import { LabOrdersService } from './labs/lab-orders.service';

@Injectable()
export class HospitalLifecycleService {
  private readonly logger = new Logger(HospitalLifecycleService.name);

  constructor(
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly visits: VisitsService,
    private readonly directory: PatientDirectoryService,
    private readonly specialists: SpecialistService,
    private readonly news2: News2Service,
    private readonly medSafety: MedicationSafetyService,
    private readonly fhirMapper: FhirService,
    private readonly fhir: FhirHapiClient,
    private readonly dicom: DicomService,
    private readonly orthanc: OrthancClient,
    private readonly rag: VectorRagService,
    private readonly post: PostCommitService,
    private readonly events: HospitalEventsGateway,
    private readonly dataSource: DataSource,
    private readonly labOrders: LabOrdersService,
  ) {}

  // ---- visits: the single place the workflow moves a visit -------------------------------------------------------

  /** Starts a new visit for a patient who is already registered (returning patient). */
  async startVisit(patientId: string, dto: StartVisitDto, user: AuthUser) {
    const patient = await this.hospital.getPatientById(patientId);
    const visit = await this.visits.start(patient.id, {
      chiefComplaint: dto.chiefComplaint,
      actor: user,
    });
    await this.announceVisit(patient, visit);
    return { success: true, patientId: patient.id, visit: this.view(visit) };
  }

  /** The one entry point for manual status changes (complete, reopen, cancel, left-without-seen, hand-offs). */
  async transitionVisit(
    visitId: string,
    dto: VisitTransitionDto,
    user: AuthUser,
  ) {
    const visit = await this.visits.transition(visitId, dto.to, user, {
      note: dto.note,
      outcome: dto.outcome,
    });
    const patient = await this.hospital.getPatientById(visit.patientId);
    await this.announceVisit(patient, visit);
    return { success: true, visit: this.view(visit) };
  }

  async visitDetail(visitId: string, user: AuthUser) {
    const visit = await this.visits.get(visitId);
    const [timeline, patient] = await Promise.all([
      this.visits.timeline(visitId),
      this.hospital.getPatientById(visit.patientId),
    ]);
    return {
      visit: this.view(visit),
      patient: { id: patient.id, name: patient.name },
      timeline,
      allowedTransitions: manualTransitionsFor(visit.status, user.role),
    };
  }

  private view(visit: VisitEntity) {
    return toVisitSummary(visit);
  }

  /** Realtime event + search-index refresh after any visit change. */
  private async announceVisit(patient: PatientEntity, visit: VisitEntity) {
    this.events.emitVisitUpdated({
      visitId: visit.id,
      patientId: patient.id,
      patientName: patient.name,
      status: visit.status,
    });
    await this.post.index(RecordDocumentBuilder.visit(patient, visit));
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
    await this.post.run('RAG cleanup', async () => {
      ragChunksRemoved = await this.rag.removePatient(patientId);
    });
    const fhirDeleted = await this.post.run('FHIR delete', () =>
      this.fhir.deletePatientCascade(patientId),
    );
    for (const inst of orthancInstanceIds) {
      await this.post.run('Orthanc delete', () =>
        this.orthanc.deleteInstance(inst),
      );
    }
    this.events.emitPatientDeleted({ patientId });
    this.logger.warn(
      `Patient ${patientId} permanently deleted: ${JSON.stringify(deleted)}`,
    );
    return { success: true, patientId, deleted, fhirDeleted, ragChunksRemoved };
  }

  // 1. RECEPTIONIST: register a new person and open their first visit (or flag a possible duplicate first)
  async registerOutpatient(dto: RegistrationDto, user: AuthUser) {
    if (!dto.allowDuplicate) {
      const phoneDigits = dto.phone.replace(/\D/g, '');
      const candidates = await this.hospital.findDuplicateCandidates(
        dto.name,
        phoneDigits,
      );
      const matches = rankMatches(candidates, {
        name: dto.name,
        phone: dto.phone,
        dob: dto.dob ?? null,
      });
      if (matches.length) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message:
            'This looks like a patient who is already registered. Open their record and start a new visit, or confirm this is a different person.',
          possibleMatches: matches.map((m) => {
            const p = candidates.find((c) => c.id === m.patientId)!;
            return { ...m, name: p.name, age: p.age, phone: p.phone };
          }),
        });
      }
    }

    const { patient, visit } = await this.dataSource.transaction(async (m) => {
      const patient = await this.hospital.createPatient(dto, m);
      const visit = await this.visits.start(
        patient.id,
        { chiefComplaint: dto.chiefComplaint, actor: user },
        m,
      );
      return { patient, visit };
    });

    const fhirSynced = await this.post.run('FHIR Patient upsert', async () => {
      await this.fhir.upsertPatient(this.fhirMapper.toFhirPatient(patient));
      await this.hospital.markFhirSynced(patient.id);
    });
    const ragIndexed =
      (await this.post.index(RecordDocumentBuilder.patient(patient))) &&
      (await this.post.index(RecordDocumentBuilder.visit(patient, visit)));

    const payload = {
      patientId: patient.id,
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      visitId: visit.id,
      chiefComplaint: visit.chiefComplaint ?? 'General OPD',
      registrationTime: visit.arrivedAt.toISOString(),
    };
    this.events.emitPatientRegistered(payload);
    this.events.emitVisitUpdated({
      visitId: visit.id,
      patientId: patient.id,
      patientName: patient.name,
      status: visit.status,
    });

    return {
      success: true,
      patientId: patient.id,
      patient: { ...patient, fhirSynced },
      visit: this.view(visit),
      fhirSynced,
      ragIndexed,
    };
  }

  // 2. DOCTOR: consultation + prescriptions, screened by the medication safety shield
  async recordDoctorConsultation(dto: ConsultationDto, user: AuthUser) {
    const patient = await this.hospital.getPatientById(dto.patientId);
    const visit = await this.visits.requireActive(patient.id);
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

    const consultation = await this.records.saveConsultation(
      patient,
      visit.id,
      user,
      {
        patientId: patient.id,
        doctorId: user.userId,
        doctorName,
        diagnosis: dto.diagnosis,
        prescriptions: dto.prescriptions,
        notes: dto.notes,
        safety,
        overrideReason: dto.overrideReason ?? null,
      },
    );

    const updated = await this.visits.get(visit.id);
    await this.post.index(
      RecordDocumentBuilder.consultation(patient, consultation),
    );
    await this.post.index(RecordDocumentBuilder.patient(patient));
    await this.announceVisit(patient, updated);

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
      visit: this.view(updated),
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
    const patient = await this.hospital.getPatientById(dto.patientId);
    const visit = await this.visits.requireActive(patient.id);
    const { status, criticalLimit } = assessLab(
      dto.testName,
      dto.value,
      dto.unit,
      dto.referenceRange,
    );

    const lab = await this.hospital.addLab({
      patientId: patient.id,
      visitId: visit.id,
      testName: dto.testName,
      value: dto.value,
      unit: dto.unit,
      referenceRange: dto.referenceRange ?? 'n/a',
      status,
      date: new Date().toISOString().slice(0, 10),
      recordedBy: user.userName,
    });

    await this.labOrders.linkResultToOrder(patient.id, dto.testName, lab.id);

    await this.post.index(RecordDocumentBuilder.lab(patient, lab));
    await this.post.run('FHIR Observation upsert', () =>
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
    const patient = await this.hospital.getPatientById(dto.patientId);
    const visit = await this.visits.requireActive(patient.id);
    const meta = this.dicom.parseDicomBuffer(file); // throws 400 on invalid DICOM

    let orthancInstanceId: string | null = null;
    const orthancStored = await this.post.run('Orthanc upload', async () => {
      orthancInstanceId = await this.orthanc.uploadInstance(file);
    });

    const study = await this.records.addImagingStudy({
      patientId: patient.id,
      visitId: visit.id,
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

    const fhirSynced = await this.post.run(
      'FHIR ImagingStudy upsert',
      async () => {
        await this.fhir.upsertImagingStudy(
          this.fhirMapper.toFhirImagingStudy(study),
        );
        await this.records.updateImagingStudy(study.id, { fhirId: study.id });
        study.fhirId = study.id;
      },
    );
    await this.post.index(RecordDocumentBuilder.imaging(patient, study));

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

  // 4. NURSE: triage + NEWS2 + SIRS + ESI suggestion; moves the visit to TRIAGED and sets its priority
  async recordTriageAndVitals(dto: TriageDto, user: AuthUser) {
    const patient = await this.hospital.getPatientById(dto.patientId);
    const visit = dto.visitId
      ? await this.visits.get(dto.visitId)
      : await this.visits.requireActive(patient.id);
    if (visit.patientId !== patient.id)
      throw new BadRequestException(
        `Visit ${visit.id} does not belong to patient ${patient.id}.`,
      );
    const assessment = this.news2.assess(dto);

    const vitals = await this.records.addVitals({
      patientId: patient.id,
      visitId: visit.id,
      heartRate: dto.heartRate,
      bpSystolic: dto.bpSystolic,
      spO2: dto.spO2,
      tempCelsius: dto.tempCelsius,
      respiratoryRate: dto.respiratoryRate,
      painScore: dto.painScore ?? null,
      symptoms: dto.symptoms ?? [],
      glucoseMgDl: dto.glucoseMgDl ?? null,
      consciousness: dto.consciousness,
      onSupplementalO2: dto.onSupplementalO2,
      news2Score: assessment.score,
      riskLevel: assessment.riskLevel,
      recordedBy: user.userName,
    });

    // Only a visit still in the waiting room advances; re-measuring vitals later leaves the status alone.
    if ((WAITING_STATUSES as readonly string[]).includes(visit.status)) {
      await this.visits.transition(visit, 'TRIAGED', user);
    }
    await this.visits.setPriority(
      visit.id,
      dto.priority ?? assessment.suggestedEsiLevel,
    );
    const updated = await this.visits.get(visit.id);

    await this.post.index(RecordDocumentBuilder.vitals(patient, vitals));
    await this.announceVisit(patient, updated);

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
      visit: this.view(updated),
      news2Score: assessment.score,
      riskLevel: assessment.riskLevel,
      breakdown: assessment.breakdown,
      sirs: assessment.sirs,
      suggestedEsiLevel: assessment.suggestedEsiLevel,
      rationale: assessment.rationale,
    };
  }

  // Appointments and tasks are tied to the patient's open visit
  async bookAppointment(dto: AppointmentDto) {
    const patient = await this.hospital.getPatientById(dto.patientId);
    const visit = await this.visits.requireActive(patient.id);
    // Against a real doctor account: the slot must be one they offer and be free; name/department come from the account.
    if (dto.doctorId) {
      const doctor = await this.specialists.assertBookable(
        dto.doctorId,
        dto.dateTime,
      );
      return this.hospital.bookAppointment({
        patientId: patient.id,
        visitId: visit.id,
        doctorId: doctor.id,
        doctorName: doctor.displayName,
        department:
          dto.department ?? doctor.specialty ?? doctor.department ?? 'General',
        dateTime: slotKey(dto.dateTime),
        reason: dto.reason,
      });
    }
    return this.hospital.bookAppointment({
      patientId: patient.id,
      visitId: visit.id,
      doctorName: dto.doctorName!,
      department: dto.department!,
      dateTime: dto.dateTime,
      reason: dto.reason,
    });
  }

  async createTask(dto: TaskDto) {
    const visit = dto.patientId
      ? await this.visits.getActive(dto.patientId)
      : null;
    return this.hospital.createTask({ ...dto, visitId: visit?.id ?? null });
  }

  // Ward board: latest vitals of every patient with an open visit, sickest first
  async wardBoard() {
    const open = await this.visits.listByStatus(ACTIVE_STATUSES, 500);
    const latest = await this.records.latestVitalsPerVisit(
      open.map((v) => v.id),
    );
    const patients = new Map(
      (
        await this.directory.list({
          ids: open.map((v) => v.patientId),
          limit: 500,
        })
      ).items.map((p) => [p.id, p]),
    );
    const visitsById = new Map(open.map((v) => [v.id, v]));
    return latest
      .filter((v) => patients.has(v.patientId))
      .map((v) => {
        const p = patients.get(v.patientId)!;
        return {
          patientId: p.id,
          name: p.name,
          age: p.age,
          gender: p.gender,
          visit: this.view(visitsById.get(v.visitId!)!),
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

  /** Waiting room: visits waiting for triage or for the doctor, with computed wait times. */
  async queue() {
    const waitAlertMinutes = this.waitAlertMinutes();
    const waiting = await this.visits.listByStatus(WAITING_STATUSES, 200);
    const patients = new Map(
      (
        await this.directory.list({
          ids: waiting.map((v) => v.patientId),
          limit: 200,
        })
      ).items.map((p) => [p.id, p]),
    );
    return {
      waitAlertMinutes,
      items: waiting.map((v) => {
        const p = patients.get(v.patientId);
        return {
          patientId: v.patientId,
          name: p?.name ?? v.patientId,
          age: p?.age ?? null,
          gender: p?.gender ?? null,
          chiefComplaint: v.chiefComplaint ?? 'General OPD',
          visit: this.view(v),
        };
      }),
    };
  }

  /** Read-only: visits waiting longer than the policy limit. Broadcasting is done by QueueMonitorService. */
  async checkUnconsultedPatientAlerts() {
    const late = await this.visits.findWaitingLongerThan(
      this.waitAlertMinutes(),
    );
    const alerts = late.map((v) => ({
      patientId: v.patientId,
      visitId: v.id,
      status: v.status,
      waitMinutes: this.view(v).waitMinutes,
    }));
    return { unconsultedAlertsCount: alerts.length, alerts };
  }

  waitAlertMinutes(): number {
    return Number(process.env.WAIT_ALERT_MINUTES ?? 30);
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
