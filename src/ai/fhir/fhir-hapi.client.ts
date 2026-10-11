/**
 * STATUS: in use, ONE-WAY. The app writes to FHIR (Patient on registration, Observation for labs, ImagingStudy for scans),
 * deletes with _cascade on patient delete, and pings it for health. The app NEVER reads clinical data back from FHIR:
 * PostgreSQL is the source of truth. `searchPatients` is only used by the ADMIN agent tool `queryLiveHapiFhirPatients`.
 *
 * TODO (future improvements):
 *  - Retry/outbox for failed syncs. Today a failed push is reported (`fhirSynced:false`) and repaired only at server
 *    start or by the admin "Re-index everything"; a background retry queue would remove that gap.
 *  - Inbound sync: import patients/results from an external EHR and reconcile conflicts (needs a mapping + de-dup policy).
 *  - Security for a real server: SMART-on-FHIR / bearer auth, TLS, paging for searches (only the first page is read).
 *  - Dev note: this currently points at another project's HAPI server (:8080). Use a dedicated one (docker compose).
 */

import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { CircuitBreaker } from '../reliability/resilience';

/**
 * ============================================================================
 * 🔗 CONCEPT: MCP / Standard External Tool & Healthcare Data Connectors
 * ============================================================================
 * WHAT IT IS:
 * Standardized protocol and connectors allowing the AI agent to interface with
 * external healthcare subsystems, electronic health records (EHR), and imaging servers
 * rather than existing in an isolated silo.
 *
 * HOW IMPLEMENTED:
 * - HL7 FHIR R4 standard client (`FhirHapiClient`) interacting with HAPI FHIR server:
 *   - Creates/syncs `Patient`, `Observation` (lab results), and `ImagingStudy` resources.
 *   - Cascading deletions and capability health checks.
 *   - DICOM Orthanc integration (`OrthancClient`) for PACS medical imaging (CT/X-ray).
 *   - Circuit breaker (`CircuitBreaker`) resilience protection against external network timeouts.
 *   - Exposed to AI agents through structured tools (e.g. `queryLiveHapiFhirPatients`).
 *
 * USE CASE:
 * Enables interoperability with hospital EHRs (Epic, Cerner) and PACS imaging archives,
 * allowing AI-assisted workflows to sync seamlessly with international healthcare standards.
 * ============================================================================
 * HL7 FHIR R4 REST client (HAPI). Failures throw: callers decide how to degrade; nothing fabricates data.
 */
@Injectable()
export class FhirHapiClient {
  private readonly logger = new Logger(FhirHapiClient.name);
  private readonly http: AxiosInstance;
  private readonly breaker = new CircuitBreaker(3, 15_000);

  constructor() {
    this.http = axios.create({
      baseURL: process.env.FHIR_SERVER_URL || 'http://localhost:8080/fhir',
      timeout: 8000,
      headers: {
        Accept: 'application/fhir+json',
        'Content-Type': 'application/fhir+json',
      },
    });
  }

  /** Idempotent create-or-update with a client-assigned id (PUT), so retries never duplicate patients. */
  async upsertPatient(resource: { resourceType: 'Patient'; id: string }) {
    return this.breaker.exec(async () => {
      const { data } = await this.http.put(`/Patient/${resource.id}`, resource);
      return data;
    });
  }

  async upsertObservation(resource: {
    resourceType: 'Observation';
    id: string;
  }) {
    return this.breaker.exec(async () => {
      const { data } = await this.http.put(
        `/Observation/${resource.id}`,
        resource,
      );
      return data;
    });
  }

  async upsertImagingStudy(resource: {
    resourceType: 'ImagingStudy';
    id: string;
  }) {
    const { data } = await this.http.put(
      `/ImagingStudy/${resource.id}`,
      resource,
    );
    return data;
  }

  /** Removes the Patient and everything that references it (Observation, ImagingStudy, ...). Missing is fine. */
  async deletePatientCascade(id: string): Promise<void> {
    try {
      await this.http.delete(`/Patient/${id}`, {
        params: { _cascade: 'delete' },
      });
    } catch (err: any) {
      if (err?.response?.status !== 404 && err?.response?.status !== 410)
        throw err;
    }
  }

  async searchPatients(count = 20) {
    const { data } = await this.http.get('/Patient', {
      params: { _count: count },
    });
    return data;
  }

  /** Capability statement fetch, used as a health probe. */
  async ping(): Promise<void> {
    await this.http.get('/metadata', {
      params: { _summary: 'true' },
      timeout: 4000,
    });
  }
}
