import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CircuitBreaker,
  CircuitOpenError,
  withRetry,
  withTimeout,
} from './resilience';

/** Runs an LLM call with timeout -> retry/backoff -> circuit breaker. Shared across requests so the breaker sees all traffic. */
@Injectable()
export class LlmRunner {
  private readonly logger = new Logger(LlmRunner.name);
  private readonly breaker = new CircuitBreaker(
    Number(process.env.AI_BREAKER_THRESHOLD ?? 5),
    Number(process.env.AI_BREAKER_COOLDOWN_MS ?? 30_000),
  );

  breakerSnapshot() {
    return this.breaker.snapshot();
  }

  async run<T>(
    label: string,
    fn: () => Promise<T>,
    onRetry?: (attempt: number) => void,
  ): Promise<T> {
    const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 45_000);
    try {
      return await this.breaker.exec(() =>
        withRetry(() => withTimeout(fn, timeoutMs, label), {
          retries: Number(process.env.AI_MAX_RETRIES ?? 2),
          baseMs: Number(process.env.AI_RETRY_BASE_MS ?? 500),
          onRetry: (attempt, err, delay) => {
            this.logger.warn(
              `${label}: transient failure, retry ${attempt} in ${Math.round(delay)}ms (${(err as Error).message})`,
            );
            onRetry?.(attempt);
          },
        }),
      );
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        throw new ServiceUnavailableException(
          'The AI service is temporarily unavailable (repeated provider failures). Please retry shortly.',
        );
      }
      throw err;
    }
  }
}
