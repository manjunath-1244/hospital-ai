import { News2Service } from '../../hospital/news2.service';
import { parseVitals, renderTriage } from './vitals-parser';

describe('parseVitals', () => {
  it('parses the full sentence from the field', () => {
    expect(
      parseVitals(
        'Assess triage: HR 125, systolic BP 92, SpO2 91% on air, temp 39.2, RR 26, confused.',
      ),
    ).toEqual({
      heartRate: 125,
      bpSystolic: 92,
      spO2: 91,
      tempCelsius: 39.2,
      respiratoryRate: 26,
      consciousness: 'CONFUSION',
      onSupplementalO2: false,
    });
  });
  it('reads oxygen use and consciousness levels', () => {
    const v = parseVitals(
      'pulse 88, bp 130, sats 94% on oxygen, temperature 37.0, respiratory rate 18, responds to voice',
    )!;
    expect(v.onSupplementalO2).toBe(true);
    expect(v.consciousness).toBe('VOICE');
  });
  it('returns null when any vital is missing (never guesses)', () => {
    expect(parseVitals('HR 125, BP 92, SpO2 91%')).toBeNull();
    expect(parseVitals('what is the triage policy')).toBeNull();
  });
  it('produces the same score as the calculator', () => {
    const v = parseVitals(
      'HR 125, systolic BP 92, SpO2 91% on air, temp 39.2, RR 26, confused',
    )!;
    const a = new News2Service().assess(v);
    expect(a.score).toBe(15);
    const text = renderTriage(v, a);
    expect(text).toContain('NEWS2 score: 15');
    expect(text).toContain('ESCALATE');
    expect(text.toLowerCase()).toContain('decision support');
  });
});
