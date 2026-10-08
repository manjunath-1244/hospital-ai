import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { HospitalService } from '../../hospital/hospital.service';
import { ClinicalRecordsService } from '../../hospital/clinical-records.service';
import { VectorRagService } from './vector-rag.service';
import { RecordDocumentBuilder } from './record-documents';
import { FhirHapiClient } from '../fhir/fhir-hapi.client';
import { FhirService } from '../fhir/fhir.service';

/**
 * Backfills patient records, consultations, vitals and imaging into the vector store on boot,
 * so records created before RAG was available (or while it was down) are searchable. Idempotent.
 */
@Injectable()
export class FhirDicomIngestService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FhirDicomIngestService.name);

  constructor(
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly rag: VectorRagService,
    private readonly fhir: FhirHapiClient,
    private readonly fhirMapper: FhirService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const r = await this.reindexAll();
      this.logger.log(
        `Patient-record backfill: ${r.patients} patients, ${r.documents} documents checked, ${r.fhirSynced} synced to FHIR.`,
      );
    } catch (err: any) {
      this.logger.error(`Patient-record backfill failed: ${err.message}`);
    }
  }

  /** Makes the search index and FHIR server match the database. Idempotent; unchanged records are skipped cheaply. */
  async reindexAll() {
    let documents = 0;
    let fhirSynced = 0;
    const { items } = await this.hospital.listPatients({ limit: 200 });
    for (const p of items) {
      await this.rag.ingest(RecordDocumentBuilder.patient(p));
      documents++;
      for (const c of await this.records.listConsultations(p.id, 50)) {
        await this.rag.ingest(RecordDocumentBuilder.consultation(p, c));
        documents++;
      }
      for (const v of await this.records.listVitals(p.id, 50)) {
        await this.rag.ingest(RecordDocumentBuilder.vitals(p, v));
        documents++;
      }
      for (const l of await this.hospital.getPatientLabs(p.id)) {
        await this.rag.ingest(RecordDocumentBuilder.lab(p, l));
        documents++;
      }
      for (const s of await this.records.listImagingStudies(p.id)) {
        await this.rag.ingest(RecordDocumentBuilder.imaging(p, s));
        documents++;
      }
      if (!p.fhirSynced) {
        try {
          await this.fhir.upsertPatient(this.fhirMapper.toFhirPatient(p));
          await this.hospital.markFhirSynced(p.id);
          fhirSynced++;
        } catch (err: any) {
          this.logger.warn(`FHIR sync of ${p.id} skipped: ${err.message}`);
        }
      }
    }
    return { patients: items.length, documents, fhirSynced };
  }
}
