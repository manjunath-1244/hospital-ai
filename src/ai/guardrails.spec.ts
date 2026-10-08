import {
  appendOmittedPatients,
  checkGuardrails,
  looksLikeRawToolCall,
  renderPatientList,
} from './guardrails';
import { ToolTrace } from './tools/tool-registry';

const traceWith = (patients: any[]) => {
  const t = new ToolTrace();
  t.record(
    { name: 'searchPatients', args: {}, success: true },
    { success: true, patients },
  );
  return t;
};
const pts = [
  {
    id: 'P1001',
    name: 'Eleanor Vance',
    age: 45,
    gender: 'female',
    status: 'SEEN',
  },
  {
    id: 'P1002',
    name: 'Marcus Brody',
    age: 62,
    gender: 'male',
    status: 'SEEN',
  },
  {
    id: 'P1003',
    name: 'Sophia Martinez',
    age: 29,
    gender: 'female',
    status: 'SEEN',
  },
];

describe('looksLikeRawToolCall', () => {
  it('detects tool calls printed as text', () => {
    expect(
      looksLikeRawToolCall(
        '{"name":"searchClinicalRecords","parameters":{"query":""}}',
      ),
    ).toBe(true);
    expect(
      looksLikeRawToolCall(
        '```json\n{"name": "getPatientSummary", "arguments": {"patientId":"P1"}}',
      ),
    ).toBe(true);
    expect(looksLikeRawToolCall('[{"name":"x","parameters":{}}]')).toBe(true);
  });
  it('does not flag normal answers', () => {
    expect(looksLikeRawToolCall('Patient P1001 has HbA1c 7.8%.')).toBe(false);
    expect(looksLikeRawToolCall('The JSON field "name" is required.')).toBe(
      false,
    );
  });
});

describe('appendOmittedPatients', () => {
  it('adds patients the model dropped from a list, and only those', () => {
    const r = appendOmittedPatients(
      '1. Eleanor Vance (P1001)\n2. Marcus Brody (P1002)',
      traceWith(pts),
    );
    expect(r.omitted).toBe(1);
    expect(r.text).toContain('Sophia Martinez (id: P1003)');
    expect(r.text.match(/Eleanor/g)).toHaveLength(1);
  });
  it('replaces unusable prose with the system list when the model listed none of them', () => {
    const r = appendOmittedPatients(
      'Please specify a limit and try again.',
      traceWith(pts),
    );
    expect(r.omitted).toBe(3);
    expect(r.text.startsWith('Patients in the system (3):')).toBe(true);
    expect(r.text).not.toContain('specify a limit');
  });
  it('leaves complete answers untouched', () => {
    const complete = 'P1001 Eleanor, P1002 Marcus, P1003 Sophia Martinez';
    expect(appendOmittedPatients(complete, traceWith(pts))).toEqual({
      text: complete,
      omitted: 0,
    });
  });
  it('ignores answers where searchPatients was not used', () => {
    expect(appendOmittedPatients('hello', new ToolTrace())).toEqual({
      text: 'hello',
      omitted: 0,
    });
  });
});

describe('checkGuardrails', () => {
  it('flags an ungrounded patient id and failed tools', () => {
    const t = new ToolTrace();
    t.record(
      {
        name: 'getPatientSummary',
        args: { patientId: 'P1001' },
        success: false,
      },
      { success: false },
    );
    const g = checkGuardrails('P1001 is fine, P1002 too', t, 'status of P1001');
    expect(g.status).toBe('WARNING');
    expect(g.notes.join()).toMatch(/P1002/);
    expect(g.notes.join()).toMatch(/getPatientSummary/);
  });
});

describe('renderPatientList', () => {
  it('renders every patient as clean numbered plain text (no JSON)', () => {
    const t = new ToolTrace();
    t.record(
      { name: 'searchPatients', args: {}, success: true },
      {
        success: true,
        total: 2,
        patients: [
          {
            id: 'P1',
            name: 'A B',
            age: 4,
            gender: 'male',
            status: 'SEEN',
            chiefComplaint: 'cough',
          },
          {
            id: 'P2',
            name: 'C D',
            age: 9,
            gender: 'female',
            status: 'WAITING',
            chiefComplaint: null,
          },
        ],
      },
    );
    const out = renderPatientList(t)!;
    expect(out).toContain('Patients in the system (2):');
    expect(out).toContain('1. A B (P1) — 4 y, male, SEEN — cough');
    expect(out).toContain('2. C D (P2) — 9 y, female, WAITING');
    expect(out).not.toMatch(/[{}]/);
  });
  it('returns null when no list was fetched', () => {
    expect(renderPatientList(new ToolTrace())).toBeNull();
  });
});
