import { resolvePeople, type Person } from './person-resolution';

const patients: Person[] = [
  { kind: 'PATIENT', id: 'P1001', name: 'Eleanor Vance' },
  { kind: 'PATIENT', id: 'P1002', name: 'Marcus Brody' },
  { kind: 'PATIENT', id: 'PAG68T8', name: 'Sarah' },
  { kind: 'PATIENT', id: 'PJFBEQF', name: 'James Miller' },
];
const staff: Person[] = [
  { kind: 'STAFF', id: 'USR-CARDIO', name: 'Dr. Sarah Wilson (Cardiology)' },
  { kind: 'STAFF', id: 'USR-NEURO', name: 'Dr. Michael Chen (Neurology)' },
];
const all = [...patients, ...staff];
const ids = (r: ReturnType<typeof resolvePeople>) =>
  r.matches.map((m) => m.person.id);

describe('who is the message about (patients and staff together)', () => {
  it('a full name matches exactly', () => {
    const r = resolvePeople('details about Eleanor Vance', all);
    expect(r.status).toBe('EXACT');
    expect(ids(r)).toEqual(['P1001']);
  });
  it('one distinctive first or last name matches', () => {
    expect(ids(resolvePeople('show Brody', all))).toEqual(['P1002']);
    expect(resolvePeople('what about miller', all).status).toBe('EXACT');
  });
  it('typos are corrected and reported, even in every word', () => {
    const r = resolvePeople('details of Elanor Vance', all);
    expect(r.status).toBe('CORRECTED');
    expect(ids(r)).toEqual(['P1001']);
    expect(resolvePeople('give details about Jmaes Millre', all).status).toBe(
      'CORRECTED',
    );
    expect(ids(resolvePeople('Jmaes Millre', all))).toEqual(['PJFBEQF']);
  });
  it('a full staff name beats a patient who shares only the first name', () => {
    expect(ids(resolvePeople('who is Sarah Wilson', all))).toEqual([
      'USR-CARDIO',
    ]);
    expect(ids(resolvePeople('Sarah Wilsoon', all))).toEqual(['USR-CARDIO']);
  });
  it('a first name shared by a patient and a staff member is shown as the one it fully names', () => {
    expect(ids(resolvePeople('details about Sarah', all))).toEqual(['PAG68T8']);
  });
  it('close candidates are returned together (never silently chosen)', () => {
    const twins: Person[] = [
      { kind: 'PATIENT', id: 'A', name: 'Jon Smythe' },
      { kind: 'PATIENT', id: 'B', name: 'Jon Smyth' },
    ];
    const r = resolvePeople('details about Jon Smyth', twins);
    expect(r.status).toBe('EXACT'); // "Jon Smyth" names B exactly; A is only one typo away
    expect(ids(r)).toEqual(['B']);
    const r2 = resolvePeople('details about Jon Smyt', twins);
    expect(r2.status).toBe('AMBIGUOUS');
    expect(ids(r2).sort()).toEqual(['A', 'B']);
  });
  it('identical full names are both returned', () => {
    const dup: Person[] = [
      { kind: 'PATIENT', id: 'A', name: 'Jane Doe' },
      { kind: 'PATIENT', id: 'B', name: 'Jane Doe' },
    ];
    expect(ids(resolvePeople('show Jane Doe', dup)).sort()).toEqual(['A', 'B']);
  });
  it('ordinary words are never names', () => {
    expect(resolvePeople('show me the patient list please', all).status).toBe(
      'NONE',
    );
    expect(resolvePeople('how many doctors are there', all).status).toBe(
      'NONE',
    );
  });
  it('a name nobody has is NONE', () => {
    expect(resolvePeople('details about Zzyzx Qwerty', all).status).toBe(
      'NONE',
    );
  });
});
