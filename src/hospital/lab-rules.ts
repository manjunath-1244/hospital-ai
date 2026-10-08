import { LabStatus } from './hospital.types';

interface CriticalRule {
  match: RegExp;
  unit: RegExp;
  low?: number;
  high?: number;
}

// Critical values apply only when the unit matches, so a value in the wrong unit is never mis-flagged.
// Thresholds follow knowledge/emergency-escalation.md (glucose) and common laboratory critical-value lists.
const CRITICAL_RULES: CriticalRule[] = [
  { match: /glucose/i, unit: /^mg\/dl$/i, low: 50, high: 250 },
  { match: /potassium/i, unit: /^mmol\/l$|^meq\/l$/i, low: 2.8, high: 6.0 },
  { match: /sodium/i, unit: /^mmol\/l$|^meq\/l$/i, low: 120, high: 160 },
  { match: /hba1c|glycated/i, unit: /^%$/, high: 10 },
  { match: /creatinine/i, unit: /^mg\/dl$/i, high: 4.0 },
  { match: /troponin/i, unit: /^ng\/ml$/i, high: 0.4 },
  { match: /lactate/i, unit: /^mmol\/l$/i, high: 4.0 },
  { match: /hemoglobin|haemoglobin/i, unit: /^g\/dl$/i, low: 7 },
  { match: /platelet/i, unit: /^(10\^9\/l|k\/ul|x10\^3\/ul)$/i, low: 20 },
];

export interface LabAssessment {
  status: LabStatus;
  criticalLimit?: string;
}

/** Classifies a result against its reference range ("a - b") and unit-aware critical limits. */
export function assessLab(
  testName: string,
  value: string,
  unit: string,
  referenceRange?: string,
): LabAssessment {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return { status: 'NORMAL' };

  const rule = CRITICAL_RULES.find(
    (r) => r.match.test(testName) && r.unit.test(unit.trim()),
  );
  if (rule) {
    if (rule.high !== undefined && n > rule.high)
      return { status: 'CRITICAL', criticalLimit: `>${rule.high} ${unit}` };
    if (rule.low !== undefined && n < rule.low)
      return { status: 'CRITICAL', criticalLimit: `<${rule.low} ${unit}` };
  }

  const m = referenceRange?.match(
    /(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/,
  );
  if (m && (n < parseFloat(m[1]) || n > parseFloat(m[2])))
    return { status: 'ABNORMAL' };
  return { status: 'NORMAL' };
}
