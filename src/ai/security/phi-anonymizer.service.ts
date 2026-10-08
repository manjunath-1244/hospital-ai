import { Injectable } from '@nestjs/common';
import { HospitalService } from '../../hospital/hospital.service';
import { PhiSession } from './phi-session';

export { PhiSession };

@Injectable()
export class PhiAnonymizerService {
  private cache: { names: string[]; at: number } | null = null;

  constructor(private readonly hospital: HospitalService) {}

  async createSession(): Promise<PhiSession> {
    if (!this.cache || Date.now() - this.cache.at > 30_000) {
      this.cache = {
        names: await this.hospital.getAllPatientNames(),
        at: Date.now(),
      };
    }
    return new PhiSession(this.cache.names);
  }
}
