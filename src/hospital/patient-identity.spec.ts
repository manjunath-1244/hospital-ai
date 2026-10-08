import { ageFromDob, resolveBirth } from './patient-identity';

const now = new Date('2026-10-08T12:00:00Z');

describe('ageFromDob', () => {
  it('counts completed years only', () => {
    expect(ageFromDob('1981-10-08', now)).toBe(45); // birthday today
    expect(ageFromDob('1981-10-09', now)).toBe(44); // birthday tomorrow
    expect(ageFromDob('2026-01-01', now)).toBe(0);
  });
});

describe('resolveBirth', () => {
  it('uses a real date of birth and marks it exact', () => {
    expect(resolveBirth({ dob: '1981-05-14' }, now)).toEqual({
      age: 45,
      dob: '1981-05-14',
      dobApproximate: false,
    });
  });
  it('a real date of birth overrides a conflicting age', () => {
    expect(resolveBirth({ age: 99, dob: '2000-01-01' }, now).age).toBe(26);
  });
  it('derives an approximate date of birth from the age and says so', () => {
    expect(resolveBirth({ age: 45 }, now)).toEqual({
      age: 45,
      dob: '1981-01-01',
      dobApproximate: true,
    });
  });
  it('rejects missing, future and implausible values', () => {
    expect(() => resolveBirth({}, now)).toThrow(/age or a date of birth/);
    expect(() => resolveBirth({ dob: '2027-01-01' }, now)).toThrow(/future/);
    expect(() => resolveBirth({ dob: '1800-01-01' }, now)).toThrow(
      /implausible/,
    );
    expect(() => resolveBirth({ dob: 'not-a-date' }, now)).toThrow(
      /valid date/,
    );
  });
});
