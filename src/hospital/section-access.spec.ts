import { mayRead } from './section-access';

describe('minimum necessary: who may read which clinical part', () => {
  it('a receptionist reads none of them', () => {
    for (const s of ['conditions', 'allergies', 'medications'] as const)
      expect(mayRead('RECEPTIONIST', s)).toBe(false);
  });
  it('a radiologist reads conditions and allergies but not medications', () => {
    expect(mayRead('RADIOLOGIST', 'conditions')).toBe(true);
    expect(mayRead('RADIOLOGIST', 'allergies')).toBe(true);
    expect(mayRead('RADIOLOGIST', 'medications')).toBe(false);
  });
  it('a care coordinator reads conditions and medications but not allergies', () => {
    expect(mayRead('CARE_COORDINATOR', 'allergies')).toBe(false);
    expect(mayRead('CARE_COORDINATOR', 'medications')).toBe(true);
  });
  it('doctors, nurses, pharmacists and admins read all three', () => {
    for (const r of ['DOCTOR', 'NURSE', 'PHARMACIST', 'ADMIN'] as const)
      for (const s of ['conditions', 'allergies', 'medications'] as const)
        expect(mayRead(r, s)).toBe(true);
  });
});
