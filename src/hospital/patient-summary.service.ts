import { Injectable } from '@nestjs/common';
import { HospitalService } from './hospital.service';
import { VisitsService } from './visits/visits.service';
import { toVisitSummary } from './visits/visit-summary';
import { ClinicalRecordsService } from './clinical-records.service';
import { MedicationSafetyService } from './medication-safety.service';
import type { UserRole } from '../security/roles.decorator';
import { mayRead } from './section-access';

/**
 * One consistent, role-aware 360° view of a patient, used by both the REST API and the agent.
 * Roles only receive the sections they are allowed to see (minimum necessary).
 */
@Injectable()
export class PatientSummaryService {
  constructor(
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly visits: VisitsService,
    private readonly medSafety: MedicationSafetyService,
  ) {}

  async summary(patientId: string, role: UserRole) {
    const p = await this.hospital.getPatientById(patientId);
    const can = (...roles: UserRole[]) => roles.includes(role);

    const out: Record<string, unknown> = {
      patient: {
        id: p.id,
        name: p.name,
        age: p.age,
        gender: p.gender,
        bloodType: p.bloodType,
        registeredAt: p.registeredAt,
      },
    };

    // Where the patient is in their care: the open (or latest) visit plus a short history.
    const recentVisits = await this.visits.listForPatient(p.id, 5);
    out.currentVisit = recentVisits.length
      ? toVisitSummary(recentVisits[0])
      : null;
    out.visitHistory = recentVisits.map((v) => toVisitSummary(v));

    if (mayRead(role, 'conditions')) {
      out.conditions = p.conditions;
    }
    if (mayRead(role, 'allergies')) out.allergies = p.allergies;
    if (mayRead(role, 'medications'))
      out.currentMedications = p.currentMedications;

    if (
      can('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'RADIOLOGIST', 'SPECIALIST')
    ) {
      const labs = await this.hospital.getPatientLabs(p.id);
      out.labs = labs.slice(0, 10).map((l) => ({
        test: l.testName,
        value: l.value,
        unit: l.unit,
        referenceRange: l.referenceRange,
        status: l.status,
        date: l.date,
      }));
    }
    if (can('DOCTOR', 'NURSE', 'ADMIN', 'PHARMACIST', 'SPECIALIST')) {
      // Computed, not inferred: current medications screened against allergies, renal function and each other.
      const labs = await this.hospital.getPatientLabs(p.id);
      const cr = labs.find((l) => /creatinine/i.test(l.testName));
      const mgDl = cr
        ? this.medSafety.creatinineToMgDl(parseFloat(cr.value), cr.unit)
        : undefined;
      const report = this.medSafety.audit(
        {
          age: p.age,
          gender: p.gender,
          allergies: p.allergies,
          currentMedications: [],
        },
        p.currentMedications,
        Number.isFinite(mgDl) ? mgDl : undefined,
      );
      out.medicationSafetyAlerts = report.findings.filter(
        (f) => f.severity !== 'INFO',
      );
    }
    if (can('DOCTOR', 'NURSE', 'ADMIN', 'SPECIALIST')) {
      out.recentVitals = (await this.records.listVitals(p.id, 3)).map((v) => ({
        at: v.recordedAt,
        heartRate: v.heartRate,
        bpSystolic: v.bpSystolic,
        spO2: v.spO2,
        tempC: v.tempCelsius,
        respiratoryRate: v.respiratoryRate,
        consciousness: v.consciousness,
        news2: v.news2Score,
        risk: v.riskLevel,
      }));
    }
    if (
      can(
        'DOCTOR',
        'NURSE',
        'ADMIN',
        'PHARMACIST',
        'CARE_COORDINATOR',
        'SPECIALIST',
      )
    ) {
      out.recentConsultations = (
        await this.records.listConsultations(p.id, 3)
      ).map((c) => ({
        at: c.createdAt,
        doctor: c.doctorName,
        diagnosis: c.diagnosis,
        prescriptions: c.prescriptions,
        notes: c.notes,
      }));
    }
    if (can('DOCTOR', 'NURSE', 'ADMIN', 'RADIOLOGIST', 'SPECIALIST')) {
      out.imaging = (await this.records.listImagingStudies(p.id)).map((s) => ({
        modality: s.modality,
        description: s.description,
        studyDate: s.studyDate,
        impression: s.impression,
      }));
    }
    if (can('DOCTOR', 'NURSE', 'ADMIN', 'RECEPTIONIST', 'CARE_COORDINATOR')) {
      out.appointments = (
        await this.hospital.getAppointmentsForPatient(p.id)
      ).map((a) => ({
        when: a.dateTime,
        doctor: a.doctorName,
        department: a.department,
        status: a.status,
        reason: a.reason,
      }));
    }
    return out;
  }
}
