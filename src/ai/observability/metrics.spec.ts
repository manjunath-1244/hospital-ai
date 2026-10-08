import { computeMetrics, detectDrift, RunRow } from './metrics';

const row = (o: Partial<RunRow> = {}): RunRow => ({
  status: 'OK',
  durationMs: 1000,
  guardrailStatus: 'VERIFIED_SAFE',
  toolCallCount: 1,
  toolFailureCount: 0,
  toolNames: ['getPatientLabs'],
  model: 'm1',
  usage: { totalTokens: 100 },
  ...o,
});
const many = (n: number, o: Partial<RunRow> = {}) =>
  Array.from({ length: n }, () => row(o));

describe('computeMetrics', () => {
  it('computes rates, percentiles and top tools', () => {
    const rows = [
      ...many(8),
      row({
        status: 'ERROR',
        toolCallCount: 0,
        toolNames: [],
        durationMs: 9000,
      }),
      row({ guardrailStatus: 'WARNING', toolFailureCount: 1 }),
    ];
    const m = computeMetrics(rows, 24);
    expect(m.runs).toBe(10);
    expect(m.errorRate).toBe(0.1);
    expect(m.guardrailWarnRate).toBe(0.1);
    expect(m.toolFailureRate).toBeCloseTo(1 / 9, 2);
    expect(m.p95LatencyMs).toBe(9000);
    expect(m.topTools[0]).toEqual({ name: 'getPatientLabs', count: 9 });
  });
  it('handles an empty window', () => {
    expect(computeMetrics([], 24)).toMatchObject({
      runs: 0,
      errorRate: 0,
      p95LatencyMs: 0,
    });
  });
});

describe('detectDrift', () => {
  const baseline = computeMetrics(many(100), 168);

  it('reports nothing for similar behaviour', () => {
    expect(detectDrift(computeMetrics(many(30), 24), baseline)).toEqual([]);
  });
  it('does not judge on too little data', () => {
    expect(
      detectDrift(computeMetrics(many(5, { status: 'ERROR' }), 24), baseline),
    ).toEqual([]);
  });
  it('flags rising errors, guardrail warnings and latency', () => {
    const bad = computeMetrics(
      [
        ...many(15),
        ...many(10, { status: 'ERROR', durationMs: 4000 }),
        ...many(5, { guardrailStatus: 'WARNING' }),
      ],
      24,
    );
    const found = detectDrift(bad, baseline).map((f) => f.metric);
    expect(found).toEqual(
      expect.arrayContaining([
        'errorRate',
        'guardrailWarnRate',
        'p95LatencyMs',
      ]),
    );
    expect(
      detectDrift(bad, baseline).find((f) => f.metric === 'errorRate')
        ?.severity,
    ).toBe('CRITICAL');
  });
  it('flags behaviour shift (tool usage) and model changes', () => {
    const shifted = computeMetrics(
      many(30, { toolCallCount: 3, model: 'm2' }),
      24,
    );
    const found = detectDrift(shifted, baseline);
    expect(found.some((f) => f.metric === 'avgToolCalls')).toBe(true);
    expect(
      found.some((f) => f.metric === 'model' && f.severity === 'INFO'),
    ).toBe(true);
  });
});
