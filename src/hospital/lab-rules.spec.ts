import { assessLab } from './lab-rules';

describe('assessLab', () => {
  it('flags critical glucose only in matching units', () => {
    expect(
      assessLab('Fasting Glucose', '300', 'mg/dL', '70 - 100').status,
    ).toBe('CRITICAL');
    expect(
      assessLab('Fasting Glucose', '300', 'mmol/L', '3.9 - 5.5').status,
    ).toBe('ABNORMAL'); // no rule for this unit, still out of range
  });
  it('flags critical potassium low and high', () => {
    expect(assessLab('Potassium', '6.4', 'mmol/L', '3.5 - 5.0').status).toBe(
      'CRITICAL',
    );
    expect(assessLab('Potassium', '2.5', 'mmol/L', '3.5 - 5.0').status).toBe(
      'CRITICAL',
    );
  });
  it('classifies by reference range', () => {
    expect(assessLab('HbA1c', '7.8', '%', '4.0 - 5.6').status).toBe('ABNORMAL');
    expect(assessLab('HbA1c', '5.0', '%', '4.0 - 5.6').status).toBe('NORMAL');
    expect(assessLab('HbA1c', '10.5', '%', '4.0 - 5.6').status).toBe(
      'CRITICAL',
    );
  });
  it('treats non-numeric values as normal rather than guessing', () => {
    expect(assessLab('Culture', 'No growth', '', undefined).status).toBe(
      'NORMAL',
    );
  });
});
