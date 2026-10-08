import { findMentionedPatients } from './mention-matching';

const patients = [
  { id: 'P1001', name: 'Eleanor Vance' },
  { id: 'P1002', name: 'Marcus Brody' },
  { id: 'PQVGMSZ', name: 'Test Patient' },
  { id: 'PX1', name: 'Saitarun' },
  { id: 'PX2', name: 'Saitarun' },
  { id: 'PA1', name: 'Anna Smith' },
  { id: 'PA2', name: 'Anna Jones' },
];
const ids = (m: string) => findMentionedPatients(m, patients).map((p) => p.id);

describe('findMentionedPatients', () => {
  it('finds patients by id, case-insensitively and only as a whole token', () => {
    expect(ids('labs for p1001 please')).toEqual(['P1001']);
    expect(ids('code P10019 is not an id')).toEqual([]);
  });
  it('finds by full name', () =>
    expect(ids('details about Marcus Brody')).toEqual(['P1002']));
  it('resolves a distinctive first name (possessive too)', () =>
    expect(ids("What are Eleanor's labs?")).toEqual(['P1001']));
  it('never treats ordinary words as names (the "Test Patient" bug)', () => {
    expect(ids('What should we do when a patient gets a rash?')).toEqual([]);
    expect(ids('please check the test results')).toEqual([]);
  });
  it('skips ambiguous names instead of guessing', () => {
    expect(ids('what about Anna?')).toEqual([]); // two Annas
    expect(ids('how is Anna Jones?')).toEqual(['PA2']); // full name disambiguates
  });
  it('returns BOTH patients when two share the exact full name (so the answer shows both charts)', () => {
    expect(ids('how is Saitarun?').sort()).toEqual(['PX1', 'PX2']);
  });
  it('limits the number of patients returned', () => {
    expect(
      findMentionedPatients('P1001 P1002 PX1 PX2', patients, 2),
    ).toHaveLength(2);
  });
});
