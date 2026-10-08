import { classifyIntent, extractPatientIds } from './intent';

describe('classifyIntent', () => {
  it.each([
    ['List all patients in the hospital.', 'list'],
    ['Provide all patient details', 'list'],
    ['show me every patient', 'list'],
    ['Who is waiting for a doctor?', 'waiting'],
    ['How many patients are waiting?', 'overview'],
    ['Give me the hospital overview', 'overview'],
    ['What is the discharge policy?', 'policy'],
    ['What is the ward emergency code word for a missing patient?', 'policy'],
    ['Which patients are allergic to penicillin?', 'crossSearch'],
  ] as const)('%s -> %s', (msg, key) => {
    expect(classifyIntent(msg)[key]).toBe(true);
  });

  it('flags write intents so they use the tool agent', () => {
    expect(classifyIntent('Book an appointment for P1001 tomorrow').write).toBe(
      true,
    );
    expect(classifyIntent('Register a new patient named John').write).toBe(
      true,
    );
    expect(classifyIntent('What are the labs for P1001?').write).toBe(false);
  });

  it('keeps medication-safety questions on the tool agent', () => {
    expect(
      classifyIntent('Is prescribing Amoxicillin 500mg safe for patient P1001?')
        .medication,
    ).toBe(true);
    expect(
      classifyIntent('Any interaction between warfarin and ibuprofen?')
        .medication,
    ).toBe(true);
    expect(classifyIntent('What are the labs for P1001?').medication).toBe(
      false,
    );
  });

  it('does not treat "total details" as a counting question', () => {
    expect(
      classifyIntent('i need total details about somisetty').overview,
    ).toBe(false);
    expect(
      classifyIntent('what is the total number of patients').overview,
    ).toBe(true);
  });

  it('flags vital-sign numbers for the triage calculator', () => {
    expect(
      classifyIntent(
        'Assess triage: HR 125, systolic BP 92, SpO2 91% on air, temp 39.2, RR 26, confused.',
      ).triage,
    ).toBe(true);
    expect(classifyIntent('NEWS2 for HR 100 BP 110').triage).toBe(true);
    expect(classifyIntent('What is the triage policy?').triage).toBe(false);
    expect(classifyIntent('what is his blood pressure').triage).toBe(false);
  });

  it('routes nothing for small talk', () => {
    const i = classifyIntent('hello there');
    expect(Object.values(i).some(Boolean)).toBe(false);
  });
});

describe('extractPatientIds', () => {
  it('finds seeded and generated ids, ignores ordinary words', () => {
    expect(extractPatientIds('labs for p1001 and PJP95QF please')).toEqual([
      'P1001',
      'PJP95QF',
    ]);
    expect(extractPatientIds('PATIENT PROBLEMS PRESCRIBE')).toEqual([]);
  });
});
