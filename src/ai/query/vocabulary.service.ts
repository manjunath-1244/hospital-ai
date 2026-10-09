import { Injectable } from '@nestjs/common';
import { SpecialistService } from '../../hospital/specialists/specialist.service';
import type { Vocabulary } from './query-plan';

/** The parts of the parser's vocabulary that live in the data (which specialties exist). Cached briefly. */
@Injectable()
export class VocabularyService {
  private cached?: { at: number; vocab: Vocabulary };

  constructor(private readonly specialists: SpecialistService) {}

  async get(): Promise<Vocabulary> {
    if (this.cached && Date.now() - this.cached.at < 60_000)
      return this.cached.vocab;
    let specialties: string[] = [];
    try {
      specialties = await this.specialists.specialties();
    } catch {
      // the parser still works without the data vocabulary (specialties are then recognised only by the lexicon)
    }
    this.cached = { at: Date.now(), vocab: { specialties } };
    return this.cached.vocab;
  }
}
