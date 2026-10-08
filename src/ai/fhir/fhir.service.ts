/**
 * STATUS: in use. Pure mappers from our records to HL7 FHIR R4: Patient, Observation (labs), ImagingStudy.
 *
 * TODO (future improvements): map the rest of the chart so FHIR is a complete second copy, with standard codes:
 *  - Condition (diagnoses, ICD-10 / SNOMED CT), AllergyIntolerance, MedicationRequest (prescriptions, RxNorm),
 *    Encounter (a visit/consultation), Practitioner (the doctor), DiagnosticReport (radiology impression).
 *  - Vitals as Observations with LOINC codes (HR, BP, SpO2, temp, RR, NEWS2); LOINC codes for labs instead of free text.
 *  - Validate every resource against HAPI ($validate) in tests before pushing.
 */

import { Injectable } from '@nestjs/common';
import type { PatientEntity } from '../../database/entities/patient.entity';
import type { LabResultEntity } from '../../database/entities/lab-result.entity';
import type { ImagingStudyEntity } from '../../database/entities/imaging-study.entity';

const FHIR_GENDERS = ['male', 'female', 'other', 'unknown'];

/** Pure mapping from internal records to HL7 FHIR R4 resources. */
@Injectable()
export class FhirService {
  toFhirPatient(
    p: Pick<PatientEntity, 'id' | 'name' | 'gender' | 'dob' | 'phone'>,
  ) {
    const parts = p.name.trim().split(/\s+/);
    const gender = p.gender.toLowerCase();
    return {
      resourceType: 'Patient' as const,
      id: p.id,
      identifier: [{ system: 'urn:hospital:patient-id', value: p.id }],
      name: [
        {
          use: 'official',
          text: p.name,
          family: parts.length > 1 ? parts[parts.length - 1] : p.name,
          given: parts.slice(0, -1),
        },
      ],
      gender: FHIR_GENDERS.includes(gender) ? gender : 'unknown',
      birthDate: p.dob,
      telecom: [{ system: 'phone', value: p.phone }],
    };
  }

  toFhirObservation(lab: LabResultEntity) {
    const numeric = parseFloat(lab.value);
    return {
      resourceType: 'Observation' as const,
      id: lab.id,
      status: 'final',
      category: [
        {
          coding: [
            {
              system:
                'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'laboratory',
            },
          ],
        },
      ],
      code: { text: lab.testName },
      subject: { reference: `Patient/${lab.patientId}` },
      effectiveDateTime: lab.date,
      ...(Number.isFinite(numeric)
        ? { valueQuantity: { value: numeric, unit: lab.unit } }
        : { valueString: `${lab.value} ${lab.unit}`.trim() }),
      interpretation: [
        {
          coding: [
            {
              system:
                'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
              code:
                lab.status === 'CRITICAL'
                  ? 'AA'
                  : lab.status === 'ABNORMAL'
                    ? 'A'
                    : 'N',
            },
          ],
        },
      ],
    };
  }

  toFhirImagingStudy(s: ImagingStudyEntity) {
    return {
      resourceType: 'ImagingStudy' as const,
      id: s.id,
      status: 'available',
      subject: { reference: `Patient/${s.patientId}` },
      ...(s.studyDate ? { started: dicomDateToIso(s.studyDate) } : {}),
      numberOfSeries: 1,
      numberOfInstances: 1,
      description: s.description ?? undefined,
      identifier: [
        { system: 'urn:dicom:uid', value: `urn:oid:${s.studyInstanceUid}` },
      ],
      series: [
        {
          uid: s.seriesInstanceUid ?? `${s.studyInstanceUid}.1`,
          number: 1,
          modality: {
            system: 'http://dicom.nema.org/resources/ontology/DCM',
            code: s.modality,
          },
          numberOfInstances: 1,
        },
      ],
      ...(s.impression ? { note: [{ text: s.impression }] } : {}),
    };
  }
}

/** DICOM DA (YYYYMMDD) -> FHIR date (YYYY-MM-DD); passes through anything already formatted. */
export function dicomDateToIso(da: string): string {
  return /^\d{8}$/.test(da)
    ? `${da.slice(0, 4)}-${da.slice(4, 6)}-${da.slice(6, 8)}`
    : da;
}
