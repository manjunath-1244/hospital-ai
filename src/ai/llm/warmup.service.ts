import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';

/**
 * Local Ollama models are unloaded after ~5 idle minutes, so the first question after a pause pays a multi-second
 * load. This keeps the chat and embedding models resident (a tiny request every 4 minutes). No effect on cloud providers.
 */
@Injectable()
export class OllamaWarmupService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OllamaWarmupService.name);
  private timer?: NodeJS.Timeout;

  async onApplicationBootstrap() {
    if (process.env.AI_WARMUP === 'false') return;
    const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const targets: Array<() => Promise<unknown>> = [];
    if ((process.env.LLM_PROVIDER ?? '').toLowerCase() === 'ollama') {
      const model = process.env.OLLAMA_MODEL || 'llama3.2:3b';
      targets.push(() =>
        this.post(`${base}/api/generate`, {
          model,
          prompt: '',
          stream: false,
          keep_alive: '30m',
        }),
      );
    }
    if ((process.env.EMBEDDING_PROVIDER ?? '').toLowerCase() === 'ollama') {
      const model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
      targets.push(() =>
        this.post(`${base}/api/embed`, {
          model,
          input: 'warm',
          keep_alive: '30m',
        }),
      );
    }
    if (!targets.length) return;

    const run = async () => {
      for (const t of targets)
        await t().catch((e: Error) =>
          this.logger.warn(`warm-up skipped: ${e.message}`),
        );
    };
    await run();
    this.logger.log(
      'Local models loaded and kept warm (no cold start on the first question).',
    );
    this.timer = setInterval(() => void run(), 4 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.text();
  }
}
