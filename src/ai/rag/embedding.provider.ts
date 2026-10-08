import { Logger } from '@nestjs/common';
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany } from 'ai';

/** Swappable text-embedding backend (Liskov: any implementation is usable wherever this is expected). */
export abstract class EmbeddingProvider {
  abstract readonly modelId: string;
  abstract readonly dimensions: number;
  abstract embed(texts: string[]): Promise<number[][]>;
  /** Queries may need different treatment than documents (e.g. instruction prefixes). Default: same. */
  async embedQuery(text: string): Promise<number[]> {
    return (await this.embed([text]))[0];
  }
}

const DIMENSIONS = 1536;

/** Semantic embeddings from OpenAI. Used when OPENAI_API_KEY is configured. */
export class OpenAiEmbeddingProvider extends EmbeddingProvider {
  readonly modelId = 'openai:text-embedding-3-small';
  readonly dimensions = DIMENSIONS;
  private readonly model;

  constructor(apiKey: string) {
    super();
    this.model = createOpenAI({ apiKey }).embedding('text-embedding-3-small');
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const { embeddings } = await embedMany({
        model: this.model,
        values: texts.slice(i, i + 96),
      });
      out.push(...embeddings);
    }
    return out;
  }
}

/**
 * Offline fallback: signed feature-hashing of word unigrams + bigrams (lexical, NOT semantic).
 * Lets the stack run without an API key; retrieval quality is keyword-level only.
 */
export class LocalHashEmbeddingProvider extends EmbeddingProvider {
  readonly modelId = 'local:hash-bow-v1';
  readonly dimensions = DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const vec = new Array<number>(this.dimensions).fill(0);
    const add = (feature: string, weight: number) => {
      const h = fnv1a(feature);
      vec[h % this.dimensions] += (h & 0x80000000 ? -1 : 1) * weight;
    };
    tokens.forEach((tok, i) => {
      add(tok, 1);
      if (i > 0) add(`${tokens[i - 1]} ${tok}`, 0.5);
    });
    let norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Semantic embeddings from a local Ollama model (e.g. nomic-embed-text): private and free, no API key. */
export class OllamaEmbeddingProvider extends EmbeddingProvider {
  readonly modelId: string;
  dimensions = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {
    super();
    this.modelId = `ollama:${model}`;
  }

  /** Learns the vector size from the model itself, so the vector column always matches. */
  async init(): Promise<this> {
    const [v] = await this.call(['dimension probe']);
    this.dimensions = v.length;
    return this;
  }

  private async call(inputs: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: inputs,
        truncate: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok)
      throw new Error(
        `Ollama embeddings failed: HTTP ${res.status} ${await res.text()}`,
      );
    return ((await res.json()) as { embeddings: number[][] }).embeddings;
  }

  // nomic-embed-text is trained with task prefixes; using them noticeably improves retrieval.
  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) {
      out.push(
        ...(await this.call(
          texts.slice(i, i + 16).map((t) => `search_document: ${t}`),
        )),
      );
    }
    return out;
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this.call([`search_query: ${text}`]))[0];
  }
}

export async function createEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EmbeddingProvider> {
  const logger = new Logger('EmbeddingProvider');
  const choice = (env.EMBEDDING_PROVIDER ?? 'auto').toLowerCase();
  const key = env.OPENAI_API_KEY?.trim();
  if (choice === 'ollama') {
    const provider = new OllamaEmbeddingProvider(
      env.OLLAMA_BASE_URL || 'http://localhost:11434',
      env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    );
    await provider.init(); // fail at startup (clearly) if Ollama or the model is missing
    logger.log(
      `Using local Ollama embeddings ${provider.modelId} (${provider.dimensions} dims, semantic).`,
    );
    return provider;
  }
  if (choice === 'openai' || (choice === 'auto' && key)) {
    if (!key)
      throw new Error('EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY');
    logger.log('Using OpenAI text-embedding-3-small (semantic).');
    return new OpenAiEmbeddingProvider(key);
  }
  logger.warn(
    'No OPENAI_API_KEY: using local lexical hash embeddings. Retrieval is keyword-level, not semantic.',
  );
  return new LocalHashEmbeddingProvider();
}
