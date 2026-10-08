import { PhiSession } from './phi-session';

describe('PhiSession', () => {
  const session = () =>
    new PhiSession(['Eleanor Vance', 'Marcus Brody', 'Jane Q Public']);

  it('masks any known patient name (not just a hard-coded few) with distinct placeholders', () => {
    const s = session();
    const masked = s.mask(
      'Compare Eleanor Vance with marcus brody and Jane Q Public.',
    );
    expect(masked).not.toMatch(/Eleanor|Marcus|Jane/i);
    expect(new Set(masked.match(/\[PATIENT_\d+\]/g)).size).toBe(3);
  });

  it('round-trips through restore', () => {
    const s = session();
    const masked = s.mask('Eleanor Vance called from +1-555-123-4567');
    expect(masked).toContain('[PHONE_1]');
    expect(s.restore(masked)).toBe('Eleanor Vance called from +1-555-123-4567');
  });

  it('masks tool output deeply and drops direct identifiers', () => {
    const s = session();
    const out = s.maskDeep({
      patient: {
        id: 'P1001',
        name: 'Eleanor Vance',
        phone: '+1-555-0147',
        dob: '1981-05-14',
        notes: ['seen: Marcus Brody'],
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/Eleanor|Marcus|555|1981/);
    expect(out.patient.id).toBe('P1001');
  });

  it('un-masks placeholders in tool inputs chosen by the model', () => {
    const s = session();
    const [ph] = s.mask('Eleanor Vance').match(/\[PATIENT_\d+\]/)!;
    expect(s.unmaskDeep({ name: ph })).toEqual({ name: 'Eleanor Vance' });
  });

  it('masks emails and SSNs', () => {
    const m = session().mask('mail a@b.com ssn 123-45-6789');
    expect(m).not.toMatch(/a@b\.com|123-45-6789/);
  });
});
