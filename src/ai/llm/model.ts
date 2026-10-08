import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';

/**
 * Resolves the chat model from env. The explicit LLM_PROVIDER wins; returns null when its key is missing,
 * so callers can fail clearly instead of silently picking a different provider.
 */
export function resolveModel(env: NodeJS.ProcessEnv = process.env): any {
  const provider = (env.LLM_PROVIDER || 'cli_proxy').toLowerCase();

  if (
    provider === 'cli_proxy' ||
    provider === 'anthropic' ||
    (env.CLI_PROXY_API_URL &&
      env.CLI_PROXY_API_TOKEN &&
      provider !== 'ollama' &&
      provider !== 'google' &&
      provider !== 'groq')
  ) {
    if (env.CLI_PROXY_API_URL && env.CLI_PROXY_API_TOKEN) {
      let baseURL = env.CLI_PROXY_API_URL.trim();
      if (!baseURL.endsWith('/v1')) {
        baseURL = baseURL.replace(/\/+$/, '') + '/v1';
      }
      const customFetch: typeof fetch = async (url, options) => {
        if (options?.body && typeof options.body === 'string') {
          try {
            const parsed = JSON.parse(options.body);
            if ('tool_choice' in parsed) {
              delete parsed.tool_choice;
              options = {
                ...options,
                body: JSON.stringify(parsed),
              };
            }
          } catch (e) {
            // keep original body if not valid JSON
          }
        }
        return fetch(url, options);
      };

      const anthropic = createAnthropic({
        apiKey: env.CLI_PROXY_API_TOKEN,
        baseURL,
        fetch: customFetch,
      });
      return anthropic(env.CLI_PROXY_MODEL || 'auto');
    }
  }

  if (provider === 'ollama') {
    return createOpenAI({
      apiKey: 'ollama',
      baseURL: `${env.OLLAMA_BASE_URL || 'http://localhost:11434'}/v1`,
    }).chat(env.OLLAMA_MODEL || 'llama3.2:3b');
  }

  if (provider === 'google') {
    const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY || env.GEMINI_API_KEY;
    return apiKey
      ? createGoogleGenerativeAI({ apiKey })(
          env.GEMINI_MODEL || 'gemini-1.5-flash',
        )
      : null;
  }

  if (provider === 'groq') {
    const apiKey = env.GROQ_API_KEY;
    return apiKey
      ? createOpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' })(
          env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        )
      : null;
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  return apiKey
    ? createOpenAI({ apiKey })(env.OPENAI_MODEL || 'gpt-4o-mini')
    : null;
}

export function llmProviderName(env: NodeJS.ProcessEnv = process.env) {
  return (env.LLM_PROVIDER || 'cli_proxy').toLowerCase();
}

export function modelLabel(env: NodeJS.ProcessEnv = process.env): string {
  const p = llmProviderName(env);
  const name =
    p === 'cli_proxy'
      ? env.CLI_PROXY_MODEL || 'auto'
      : p === 'ollama'
        ? env.OLLAMA_MODEL || 'llama3.2:3b'
        : p === 'google'
          ? env.GEMINI_MODEL || 'gemini-1.5-flash'
          : p === 'groq'
            ? env.GROQ_MODEL || 'llama-3.3-70b-versatile'
            : env.OPENAI_MODEL || 'gpt-4o-mini';
  return `${p}:${name}`;
}
