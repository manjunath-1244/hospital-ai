import { MedicationSafetyService } from './medication-safety.service';

describe('MedicationSafetyService', () => {
  const svc = new MedicationSafetyService();
  const patient = {
    age: 45,
    gender: 'female',
    allergies: ['Penicillin', 'Sulfa drugs'],
    currentMedications: ['Lisinopril 10mg', 'Metformin 500mg'],
  };

  it('normalises drug names', () => {
    expect(svc.normalizeDrug('Amoxicillin 500mg TID')).toBe('amoxicillin');
    expect(svc.normalizeDrug('Metformin (Glucophage) 500 mg')).toBe(
      'metformin',
    );
  });

  it('blocks a drug from an allergic class', () => {
    const r = svc.audit(patient, ['Amoxicillin 500mg']);
    expect(r.status).toBe('CRITICAL_BLOCK');
    expect(r.findings[0]).toMatchObject({
      type: 'ALLERGY',
      severity: 'CRITICAL',
    });
  });

  it('warns about cephalosporin cross-reactivity without blocking', () => {
    const r = svc.audit(patient, ['Cephalexin 500mg']);
    expect(r.status).toBe('WARNING');
    expect(r.findings[0].type).toBe('CROSS_REACTIVITY');
  });

  it('flags duplicate therapy', () => {
    expect(
      svc
        .audit(patient, ['Metformin 850mg'])
        .findings.some((f) => f.type === 'DUPLICATE_THERAPY'),
    ).toBe(true);
  });

  it('applies renal rules from creatinine (CKD-EPI 2021)', () => {
    const egfr = svc.egfr(1.9, 45, 'female');
    expect(egfr).toBeGreaterThan(25);
    expect(egfr).toBeLessThan(35);
    const r = svc.audit(
      { ...patient, currentMedications: [] },
      ['Metformin 500mg'],
      3.0,
    );
    expect(r.status).toBe('CRITICAL_BLOCK');
    expect(r.findings[0].type).toBe('RENAL');
  });

  it('notes unknown renal function for renally cleared drugs', () => {
    const r = svc.audit({ ...patient, allergies: [], currentMedications: [] }, [
      'Ibuprofen 400mg',
    ]);
    expect(r.findings[0]).toMatchObject({ type: 'RENAL', severity: 'INFO' });
    expect(r.status).toBe('SAFE');
  });

  it('detects dangerous interactions with current medications', () => {
    const r = svc.audit(
      { ...patient, allergies: [], currentMedications: ['Warfarin 5mg'] },
      ['Ibuprofen 400mg'],
      0.8,
    );
    expect(
      r.findings.some(
        (f) => f.type === 'INTERACTION' && f.severity === 'CRITICAL',
      ),
    ).toBe(true);
  });

  it('does not treat "None" as an allergy', () => {
    expect(
      svc.audit({ ...patient, allergies: ['None'], currentMedications: [] }, [
        'Amoxicillin 500mg',
      ]).status,
    ).toBe('SAFE');
  });
});
