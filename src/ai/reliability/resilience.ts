/** Failure-handling primitives for calling an unreliable dependency (the LLM provider). Pure and unit-tested. */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Circuit open; retry in ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}

export function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    fn().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** Transient provider/network failures worth retrying. Auth, validation and 4xx (except 408/429) are not. */
export function isRetryable(err: any, depth = 0): boolean {
  if (!err || depth > 3) return false;
  if (err instanceof TimeoutError) return true;
  const status =
    err.statusCode ??
    err.status ??
    err.response?.status ??
    err.cause?.statusCode ??
    err.cause?.status ??
    err.error?.statusCode ??
    err.error?.status;
  if (typeof status === 'number')
    return status === 408 || status === 429 || status >= 500;
  if (typeof err.code === 'string' && TRANSIENT_CODES.has(err.code))
    return true;
  if (
    typeof err.message === 'string' &&
    /rate.?limit|overloaded|unavailab|temporar|timed? ?out|socket hang up|50[0234]/i.test(
      err.message,
    )
  )
    return true;
  return (
    isRetryable(err.cause ?? err.lastError, depth + 1) ||
    isRetryable(err.error, depth + 1)
  );
}

export interface RetryOptions {
  retries: number;
  baseMs: number;
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

/** Exponential backoff with jitter. Non-retryable errors surface immediately. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.retries || !isRetryable(err)) throw err;
      const delay = opts.baseMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
      opts.onRetry?.(attempt + 1, err, delay);
      await sleep(delay);
    }
  }
}

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Opens after `failureThreshold` consecutive infrastructure failures, fails fast during `cooldownMs`,
 * then lets one trial call through (HALF_OPEN). Only retryable (provider-side) errors count as failures,
 * so a user's bad input can never trip it.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private trial = false;

  constructor(
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): BreakerState {
    if (this.failures < this.failureThreshold) return 'CLOSED';
    return this.now() - this.openedAt >= this.cooldownMs ? 'HALF_OPEN' : 'OPEN';
  }

  snapshot() {
    return { state: this.state, consecutiveFailures: this.failures };
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'OPEN')
      throw new CircuitOpenError(
        this.cooldownMs - (this.now() - this.openedAt),
      );
    if (state === 'HALF_OPEN') {
      if (this.trial) throw new CircuitOpenError(this.cooldownMs);
      this.trial = true;
    }
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      if (isRetryable(err)) {
        this.failures++;
        if (this.failures >= this.failureThreshold) this.openedAt = this.now();
      }
      throw err;
    } finally {
      this.trial = false;
    }
  }
}
