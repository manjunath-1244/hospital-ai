import {
  normalizeName,
  normalizePhone,
  rankMatches,
  scoreMatch,
  phonesMatch,
} from './patient-matching';

const eleanor = {
  id: 'P1001',
  name: 'Eleanor Vance',
  phone: '+1-555-0147',
  dob: '1981-05-14',
  dobApproximate: false,
};
const approx = {
  id: 'P9',
  name: 'Some One',
  phone: '5550001111',
  dob: '1990-01-01',
  dobApproximate: true,
};

describe('patient duplicate matching', () => {
  it('normalises names and phones', () => {
    expect(normalizeName('  Éléanor   VANCE. ')).toBe('eleanor vance');
    expect(normalizePhone('+1 (555) 0147')).toBe('15550147');
    expect(phonesMatch('+1 555 0147', '555-0147')).toBe(true); // country code on one side only
    expect(phonesMatch('+1 555 0147', '555-0148')).toBe(false);
    expect(phonesMatch('123', '123')).toBe(false); // too short to compare
  });
  it('same name + same phone is a HIGH match', () => {
    const m = scoreMatch(eleanor, { name: 'eleanor vance', phone: '555 0147' });
    expect(m).toMatchObject({
      strength: 'HIGH',
      reasons: ['SAME_NAME', 'SAME_PHONE'],
    });
  });
  it('same name + real date of birth is HIGH even with a new phone', () => {
    expect(
      scoreMatch(eleanor, {
        name: 'Eleanor Vance',
        phone: '999 888 7777',
        dob: '1981-05-14',
      })?.strength,
    ).toBe('HIGH');
  });
  it('an approximate (derived) date of birth is never used to match', () => {
    expect(
      scoreMatch(approx, {
        name: 'Other Person',
        phone: '000 000 0000',
        dob: '1990-01-01',
      }),
    ).toBeNull();
  });
  it('only a name, or only a phone, is a MEDIUM match', () => {
    expect(
      scoreMatch(eleanor, { name: 'Eleanor Vance', phone: '111 222 3333' })
        ?.strength,
    ).toBe('MEDIUM');
    expect(
      scoreMatch(eleanor, { name: 'Someone Else', phone: '555-0147' })
        ?.strength,
    ).toBe('MEDIUM');
  });
  it('different name and phone is no match; too-short phones never match', () => {
    expect(
      scoreMatch(eleanor, { name: 'Marcus Brody', phone: '111 222 3333' }),
    ).toBeNull();
    expect(
      scoreMatch({ ...eleanor, phone: '123' }, { name: 'Zed', phone: '123' }),
    ).toBeNull();
  });
  it('ranks HIGH before MEDIUM', () => {
    const ranked = rankMatches(
      [eleanor, { ...eleanor, id: 'P2', phone: '999' }],
      { name: 'Eleanor Vance', phone: '555-0147' },
    );
    expect(ranked.map((m) => [m.patientId, m.strength])).toEqual([
      ['P1001', 'HIGH'],
      ['P2', 'MEDIUM'],
    ]);
  });
});
