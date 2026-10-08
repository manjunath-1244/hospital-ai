import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { modelLabel, resolveModel } from './model';

/** The only place the app obtains a chat model (dependency inversion + a seam for evals and tests). */
@Injectable()
export class LlmProvider {
  private override?: { model: any; label: string };

  /** Test/eval seam: replace the real model with a scripted one. Pass undefined to restore. */
  useModel(model: any | undefined, label = 'scripted:test') {
    this.override = model ? { model, label } : undefined;
  }

  getModel(): any {
    if (this.override) return this.override.model;
    const model = resolveModel();
    if (!model) {
      throw new ServiceUnavailableException(
        'No LLM configured. Set LLM_PROVIDER and the matching API key (OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / GROQ_API_KEY).',
      );
    }
    return model;
  }

  label(): string {
    return this.override?.label ?? modelLabel();
  }
}
