import {
  CircuitBreaker,
  CircuitOpenError,
  TimeoutError,
  isRetryable,
  withRetry,
  withTimeout,
} from './resilience';

const fail = (status: number) =>
  Object.assign(new Error(`http ${status}`), { statusCode: status });

describe('isRetryable', () => {
  it('retries rate limits, 5xx, timeouts and network resets; not auth/validation', () => {
    expect(isRetryable(fail(429))).toBe(true);
    expect(isRetryable(fail(503))).toBe(true);
    expect(isRetryable(new TimeoutError('x', 1))).toBe(true);
    expect(
      isRetryable(Object.assign(new Error('x'), { code: 'ECONNRESET' })),
    ).toBe(true);
    expect(isRetryable(fail(401))).toBe(false);
    expect(isRetryable(fail(400))).toBe(false);
    expect(isRetryable(new Error('Invalid input'))).toBe(false);
  });
  it('looks through wrapped causes', () => {
    expect(
      isRetryable(Object.assign(new Error('wrapper'), { cause: fail(502) })),
    ).toBe(true);
  });
});

describe('withRetry', () => {
  const sleep = jest.fn().mockResolvedValue(undefined);
  beforeEach(() => sleep.mockClear());

  it('recovers after transient failures and reports each retry', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(fail(503))
      .mockRejectedValueOnce(fail(429))
      .mockResolvedValue('ok');
    const onRetry = jest.fn();
    await expect(
      withRetry(fn, { retries: 2, baseMs: 10, sleep, onRetry }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
  it('gives up after the retry budget', async () => {
    const fn = jest.fn().mockRejectedValue(fail(503));
    await expect(
      withRetry(fn, { retries: 2, baseMs: 1, sleep }),
    ).rejects.toThrow('http 503');
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('does not retry non-transient errors', async () => {
    const fn = jest.fn().mockRejectedValue(fail(401));
    await expect(
      withRetry(fn, { retries: 3, baseMs: 1, sleep }),
    ).rejects.toThrow('http 401');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  it('rejects slow calls and passes fast ones', async () => {
    await expect(
      withTimeout(() => new Promise((r) => setTimeout(r, 200)), 20, 'slow'),
    ).rejects.toBeInstanceOf(TimeoutError);
    await expect(
      withTimeout(() => Promise.resolve(7), 50, 'fast'),
    ).resolves.toBe(7);
  });
});

describe('CircuitBreaker', () => {
  it('opens after consecutive provider failures, fails fast, then half-opens and closes on success', async () => {
    let t = 0;
    const b = new CircuitBreaker(3, 1000, () => t);
    for (let i = 0; i < 3; i++)
      await expect(b.exec(() => Promise.reject(fail(503)))).rejects.toThrow(
        'http 503',
      );
    expect(b.state).toBe('OPEN');
    const probe = jest.fn();
    await expect(b.exec(probe)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(probe).not.toHaveBeenCalled();

    t = 1500;
    expect(b.state).toBe('HALF_OPEN');
    await expect(b.exec(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(b.state).toBe('CLOSED');
  });
  it('a failed half-open trial re-opens it', async () => {
    let t = 0;
    const b = new CircuitBreaker(1, 1000, () => t);
    await expect(b.exec(() => Promise.reject(fail(500)))).rejects.toThrow();
    t = 2000;
    await expect(b.exec(() => Promise.reject(fail(500)))).rejects.toThrow();
    expect(b.state).toBe('OPEN');
  });
  it('user errors never trip it', async () => {
    const b = new CircuitBreaker(2, 1000);
    for (let i = 0; i < 5; i++)
      await expect(b.exec(() => Promise.reject(fail(400)))).rejects.toThrow();
    expect(b.state).toBe('CLOSED');
  });
});
