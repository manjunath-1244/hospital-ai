import type {
  TriageAssessment,
  VitalsInput,
} from '../../hospital/news2.service';

const num = (m: RegExpMatchArray | null) => (m ? parseFloat(m[1]) : undefined);

/**
 * Extracts the five NEWS2 vitals from free text ("HR 125, systolic BP 92, SpO2 91% on air, temp 39.2, RR 26, confused").
 * Returns null unless ALL five are present: a clinical score must never be computed from guessed inputs.
 */
export function parseVitals(text: string): VitalsInput | null {
  const t = text.toLowerCase();
  const hr = num(
    t.match(/\b(?:hr|heart rate|pulse)\s*(?:of|is|at|[:=])?\s*(\d{2,3})\b/),
  );
  const sbp = num(
    t.match(
      /\b(?:systolic(?: bp)?|sbp|bp|blood pressure)\s*(?:of|is|at|[:=])?\s*(\d{2,3})\b/,
    ),
  );
  const spo2 = num(
    t.match(
      /\b(?:spo2|sats?|saturation|oxygen saturation)\s*(?:of|is|at|[:=])?\s*(\d{2,3})\s*%?/,
    ),
  );
  const temp = num(
    t.match(/\b(?:temp(?:erature)?)\s*(?:of|is|at|[:=])?\s*(\d{2}(?:\.\d)?)\b/),
  );
  const rr = num(
    t.match(
      /\b(?:rr|resp(?:iratory)? rate|breathing rate)\s*(?:of|is|at|[:=])?\s*(\d{1,2})\b/,
    ),
  );
  if ([hr, sbp, spo2, temp, rr].some((v) => v === undefined)) return null;

  const consciousness: VitalsInput['consciousness'] =
    /unrespons|unconscious/.test(t)
      ? 'UNRESPONSIVE'
      : /\bresponds? to pain\b|\bpain only\b/.test(t)
        ? 'PAIN'
        : /\bresponds? to voice\b|\bvoice only\b/.test(t)
          ? 'VOICE'
          : /confus|disorient|drowsy|agitat/.test(t)
            ? 'CONFUSION'
            : 'ALERT';
  const onO2 =
    !/\b(room air|on air|breathing air)\b/.test(t) &&
    /\b(on|with)\s+(supplemental\s+)?(oxygen|o2)\b|\bsupplemental (oxygen|o2)\b|\bnasal cannula\b|\bnrb\b/.test(
      t,
    );

  return {
    heartRate: hr!,
    bpSystolic: sbp!,
    spO2: spo2!,
    tempCelsius: temp!,
    respiratoryRate: rr!,
    consciousness,
    onSupplementalO2: onO2,
  };
}

export function renderTriage(v: VitalsInput, a: TriageAssessment): string {
  const b = a.breakdown;
  return [
    `NEWS2 score: ${a.score} (${a.riskLevel.replace('_', '-')})${a.escalate ? ' — ESCALATE: aggregate ≥5 or a single parameter scoring 3' : ''}`,
    `Inputs used: HR ${v.heartRate}, systolic BP ${v.bpSystolic}, SpO2 ${v.spO2}% ${v.onSupplementalO2 ? 'on oxygen' : 'on air'}, temp ${v.tempCelsius}°C, RR ${v.respiratoryRate}, consciousness ${v.consciousness}`,
    `Breakdown: respiratory rate ${b.respiratoryRate}, SpO2 ${b.spO2}, supplemental O2 ${b.supplementalO2}, systolic BP ${b.systolicBp}, heart rate ${b.heartRate}, consciousness ${b.consciousness}, temperature ${b.temperature}`,
    `SIRS screen: ${a.sirs.count}/3 criteria${a.sirs.criteria.length ? ` (${a.sirs.criteria.join('; ')})` : ''} — ${a.sirs.positive ? 'POSITIVE' : 'negative'} (WBC/PaCO2 not assessed)`,
    `Suggested ESI level: ${a.suggestedEsiLevel}`,
    a.rationale,
  ].join('\n');
}
