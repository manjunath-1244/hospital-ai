import { Module } from '@nestjs/common';
import { FhirHapiClient } from './fhir-hapi.client';
import { FhirService } from './fhir.service';
import { DicomService } from '../dicom/dicom.service';
import { OrthancClient } from '../dicom/orthanc.client';

/** Interoperability adapters: FHIR (HAPI), DICOM parsing, Orthanc PACS. No domain logic. */
@Module({
  providers: [FhirHapiClient, FhirService, DicomService, OrthancClient],
  exports: [FhirHapiClient, FhirService, DicomService, OrthancClient],
})
export class InteropModule {}
