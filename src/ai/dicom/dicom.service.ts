/**
 * STATUS: in use. Parses an uploaded .dcm (Radiology portal -> HospitalLifecycleService.recordImagingStudy).
 *
 * TODO (future improvements, none are implemented today):
 *  - SAFETY: compare the DICOM PatientID / PatientName with the patient selected in the UI and warn on a mismatch
 *    (wrong-patient scans are a classic clinical error). Today the selected patient wins and the tags are only stored.
 *  - One .dcm = one study record. Accept a whole study (zip / several instances / series) and group by StudyInstanceUID.
 *  - De-identify or strip PHI tags (PatientName, PatientBirthDate, ...) before sending the file to the PACS when required.
 *  - Read more tags (BodyPart, Manufacturer, number of frames) and validate transfer syntax; reject non-image objects.
 */

import { BadRequestException, Injectable } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const dicomParser = require('dicom-parser');

export interface DicomMetadata {
  patientId?: string;
  patientName?: string;
  modality: string;
  studyInstanceUid: string;
  seriesInstanceUid?: string;
  studyDate?: string;
  studyDescription?: string;
  rows?: number;
  columns?: number;
}

@Injectable()
export class DicomService {
  /**
   * Parses a real DICOM file. Missing mandatory tags are an error: we never invent a modality, UID or patient.
   */
  parseDicomBuffer(buffer: Buffer): DicomMetadata {
    let ds: any;
    try {
      ds = dicomParser.parseDicom(new Uint8Array(buffer));
    } catch {
      throw new BadRequestException(
        'File is not a valid DICOM (Part 10) object',
      );
    }
    const modality = ds.string('x00080060');
    const studyInstanceUid = ds.string('x0020000d');
    if (!modality || !studyInstanceUid) {
      throw new BadRequestException(
        'DICOM is missing required tags (Modality, StudyInstanceUID)',
      );
    }
    return {
      patientId: ds.string('x00100020') || undefined,
      patientName: ds.string('x00100010') || undefined,
      modality,
      studyInstanceUid,
      seriesInstanceUid: ds.string('x0020000e') || undefined,
      studyDate: ds.string('x00080020') || undefined,
      studyDescription: ds.string('x00081030') || undefined,
      rows: ds.uint16('x00280010'),
      columns: ds.uint16('x00280011'),
    };
  }
}
