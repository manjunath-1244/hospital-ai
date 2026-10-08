import {
  editDistance,
  findFuzzyPatients,
  findMentionedPatients,
} from './mention-matching';

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

describe('fuzzy name matching (typing mistakes)', () => {
  const people = [
    { id: 'P1', name: 'James Miller' },
    { id: 'P2', name: 'Sarah Wilson' },
    { id: 'P3', name: 'Marcus Brody' },
  ];
  it('finds the patient despite a typo', () => {
    const m = findFuzzyPatients('give details about James Mllelr', people);
    expect(m.map((x) => x.patient.id)).toEqual(['P1']);
    expect(m[0].typed).toBe('mllelr');
  });
  it('handles swapped letters and a short slip', () => {
    expect(findFuzzyPatients('show marcsu', people)[0].patient.id).toBe('P3');
    expect(findFuzzyPatients('info on wilsno', people)[0].patient.id).toBe(
      'P2',
    );
  });
  it('does not match unrelated words', () => {
    expect(
      findFuzzyPatients('show me the medication list please', people),
    ).toEqual([]);
  });
  it('returns every equally close candidate so the caller can ask', () => {
    const two = [...people, { id: 'P4', name: 'Jim Miler' }];
    expect(findFuzzyPatients('details for mller', two).length).toBeGreaterThan(
      1,
    );
  });
  it('measures edits with swaps counting once', () => {
    expect(editDistance('miller', 'mllelr')).toBe(2);
    expect(editDistance('wilson', 'wilsno')).toBe(1);
  });
});

describe('short slips', () => {
  const people = [
    { id: 'P1', name: 'Sarah' },
    { id: 'P2', name: 'Wendell Gray' },
  ];
  it('a 4-letter slip that starts like the name matches; a different start does not', () => {
    expect(findFuzzyPatients('details about Sarh', people)[0].patient.id).toBe(
      'P1',
    );
    expect(findFuzzyPatients('details about Barh', people)).toEqual([]);
  });
});
