/**
 * STATUS: in use. Stores uploads in Orthanc, serves the PNG preview, deletes instances (only when no other study uses
 * them), health ping. `listStudies` is used only by the ADMIN/RADIOLOGIST agent tool `queryLiveOrthancStudies`.
 *
 * TODO (future improvements):
 *  - Use DICOMweb (QIDO-RS / WADO-RS) to browse studies and series, and embed a real viewer (Cornerstone.js / OHIF)
 *    instead of the single PNG preview, so radiologists can scroll, zoom and window/level.
 *  - Support several instances per study and delete by study id; react to Orthanc's "stable study" events (webhook/poll).
 *  - Production: TLS, per-user auth to the PACS, and not sharing a PACS with another application (dev currently
 *    points at another project's Orthanc on :8042 — run this project's own via docker compose).
 */

import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

/** Orthanc PACS: store DICOM instances, render previews, QIDO-RS study search. Failures throw. */
@Injectable()
export class OrthancClient {
  private readonly http: AxiosInstance;

  constructor() {
    const user = process.env.ORTHANC_USERNAME;
    this.http = axios.create({
      baseURL: process.env.ORTHANC_URL || 'http://localhost:8042',
      timeout: 15000,
      ...(user
        ? {
            auth: {
              username: user,
              password: process.env.ORTHANC_PASSWORD ?? '',
            },
          }
        : {}),
    });
  }

  /** Stores one DICOM instance; returns Orthanc's instance id. */
  async uploadInstance(buffer: Buffer): Promise<string> {
    const { data } = await this.http.post('/instances', buffer, {
      headers: { 'Content-Type': 'application/dicom' },
    });
    return data.ID as string;
  }

  async getPreviewPng(instanceId: string): Promise<Buffer> {
    const { data } = await this.http.get(
      `/instances/${encodeURIComponent(instanceId)}/preview`,
      {
        responseType: 'arraybuffer',
        headers: { Accept: 'image/png' },
      },
    );
    return Buffer.from(data);
  }

  async deleteInstance(instanceId: string): Promise<void> {
    try {
      await this.http.delete(`/instances/${encodeURIComponent(instanceId)}`);
    } catch (err: any) {
      if (err?.response?.status !== 404) throw err;
    }
  }

  async listStudies() {
    const { data } = await this.http.get('/dicom-web/studies', {
      headers: { Accept: 'application/dicom+json' },
    });
    return data;
  }

  async ping(): Promise<void> {
    await this.http.get('/system', { timeout: 4000 });
  }
}
