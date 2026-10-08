import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { LlmProvider } from '../llm/llm-provider';
import { LlmRunner } from '../reliability/llm-runner';
import { PhiAnonymizerService } from '../security/phi-anonymizer.service';
import type { Msg } from './context-window';

/** Folds older turns into a short rolling summary. Names are masked before the text reaches the model and restored after. */
@Injectable()
export class SummarizerService {
  constructor(
    private readonly llm: LlmProvider,
    private readonly runner: LlmRunner,
    private readonly phi: PhiAnonymizerService,
  ) {}

  async summarize(previous: string | null, messages: Msg[]): Promise<string> {
    const session = await this.phi.createSession();
    const transcript = messages
      .map((m) => `${m.role.toUpperCase()}: ${session.mask(m.content)}`)
      .join('\n');
    const prior = previous
      ? `EXISTING SUMMARY:\n${session.mask(previous)}\n\n`
      : '';
    const agent = new Agent({
      id: 'conversation-summarizer',
      name: 'Conversation Summarizer',
      instructions:
        'Summarise the conversation for another assistant to continue it. Keep: patient ids, decisions made, actions taken, open questions. Add nothing that is not in the text. Maximum 150 words. Placeholders like [PATIENT_1] must be kept verbatim.',
      model: this.llm.getModel(),
    } as any);
    const result = await this.runner.run('summarize', () =>
      agent.generate(`${prior}NEW TURNS:\n${transcript}`),
    );
    return session.restore(result.text).trim();
  }
}
