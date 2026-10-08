import { Injectable } from '@nestjs/common';

export type Consciousness =
  'ALERT' | 'CONFUSION' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE';
export type RiskLevel = 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH';

export interface VitalsInput {
  respiratoryRate: number;
  spO2: number;
  onSupplementalO2: boolean;
  bpSystolic: number;
  heartRate: number;
  consciousness: Consciousness;
  tempCelsius: number;
  /** Use SpO2 Scale 2 (target 88-92%) for patients with hypercapnic respiratory failure. */
  spo2Scale2?: boolean;
  painScore?: number;
}

export interface News2Result {
  score: number;
  riskLevel: RiskLevel;
  breakdown: Record<
    | 'respiratoryRate'
    | 'spO2'
    | 'supplementalO2'
    | 'systolicBp'
    | 'heartRate'
    | 'consciousness'
    | 'temperature',
    number
  >;
  /** NEWS2 escalation: aggregate >= 5 or any single parameter scoring 3. */
  escalate: boolean;
}

export interface SirsResult {
  count: number;
  criteria: string[];
  positive: boolean;
}

export interface TriageAssessment extends News2Result {
  sirs: SirsResult;
  suggestedEsiLevel: 1 | 2 | 3 | 4 | 5;
  rationale: string;
}

/** Royal College of Physicians NEWS2 (2017) scoring plus SIRS screen and an ESI suggestion. Decision support only. */
@Injectable()
export class News2Service {
  calculate(v: VitalsInput): News2Result {
    const breakdown = {
      respiratoryRate: this.rr(v.respiratoryRate),
      spO2: v.spo2Scale2
        ? this.spo2Scale2(v.spO2, v.onSupplementalO2)
        : this.spo2Scale1(v.spO2),
      supplementalO2: v.onSupplementalO2 ? 2 : 0,
      systolicBp: this.sbp(v.bpSystolic),
      heartRate: this.hr(v.heartRate),
      consciousness: v.consciousness === 'ALERT' ? 0 : 3,
      temperature: this.temp(v.tempCelsius),
    };
    const parts = Object.values(breakdown);
    const score = parts.reduce((a, b) => a + b, 0);
    const anyRed = parts.some((p) => p === 3);
    const riskLevel: RiskLevel =
      score >= 7
        ? 'HIGH'
        : score >= 5
          ? 'MEDIUM'
          : anyRed
            ? 'LOW_MEDIUM'
            : 'LOW';
    return { score, riskLevel, breakdown, escalate: score >= 5 || anyRed };
  }

  sirs(
    v: Pick<VitalsInput, 'tempCelsius' | 'heartRate' | 'respiratoryRate'>,
  ): SirsResult {
    const criteria: string[] = [];
    if (v.tempCelsius > 38 || v.tempCelsius < 36)
      criteria.push(`Temperature ${v.tempCelsius}°C (>38 or <36)`);
    if (v.heartRate > 90) criteria.push(`Heart rate ${v.heartRate} (>90)`);
    if (v.respiratoryRate > 20)
      criteria.push(`Respiratory rate ${v.respiratoryRate} (>20)`);
    // WBC / PaCO2 criteria need labs and are not assessed at triage.
    return { count: criteria.length, criteria, positive: criteria.length >= 2 };
  }

  assess(v: VitalsInput): TriageAssessment {
    const news = this.calculate(v);
    const sirs = this.sirs(v);
    const reasons: string[] = [];
    let esi: 1 | 2 | 3 | 4 | 5;

    if (
      v.consciousness === 'UNRESPONSIVE' ||
      v.consciousness === 'PAIN' ||
      v.spO2 < 85 ||
      v.bpSystolic < 70
    ) {
      esi = 1;
      reasons.push(
        'Immediate life threat indicators (consciousness / SpO2 / systolic BP)',
      );
    } else if (
      news.riskLevel === 'HIGH' ||
      (news.escalate && news.riskLevel === 'MEDIUM' && sirs.positive) ||
      v.consciousness !== 'ALERT'
    ) {
      esi = 2;
      reasons.push(
        `NEWS2 ${news.score} (${news.riskLevel})${sirs.positive ? ' with positive SIRS screen' : ''}${v.consciousness !== 'ALERT' ? ', altered consciousness' : ''}`,
      );
    } else if (news.escalate || sirs.positive) {
      esi = 3;
      reasons.push(
        news.escalate
          ? `NEWS2 escalation criteria met (${news.score})`
          : 'Positive SIRS screen',
      );
    } else if (news.score >= 1) {
      esi = 4;
      reasons.push(`Low NEWS2 (${news.score})`);
    } else {
      esi = (v.painScore ?? 0) >= 7 ? 4 : 5;
      reasons.push('Physiologically stable');
    }
    return {
      ...news,
      sirs,
      suggestedEsiLevel: esi,
      rationale: `${reasons.join('; ')}. Decision support only: the triage nurse assigns the final ESI level.`,
    };
  }

  private rr(n: number) {
    return n <= 8 ? 3 : n <= 11 ? 1 : n <= 20 ? 0 : n <= 24 ? 2 : 3;
  }
  private spo2Scale1(n: number) {
    return n <= 91 ? 3 : n <= 93 ? 2 : n <= 95 ? 1 : 0;
  }
  private spo2Scale2(n: number, o2: boolean) {
    if (n <= 83) return 3;
    if (n <= 85) return 2;
    if (n <= 87) return 1;
    if (n <= 92) return 0;
    if (!o2) return 0; // >=93 on air scores 0
    return n <= 94 ? 1 : n <= 96 ? 2 : 3;
  }
  private sbp(n: number) {
    return n <= 90 ? 3 : n <= 100 ? 2 : n <= 110 ? 1 : n <= 219 ? 0 : 3;
  }
  private hr(n: number) {
    return n <= 40
      ? 3
      : n <= 50
        ? 1
        : n <= 90
          ? 0
          : n <= 110
            ? 1
            : n <= 130
              ? 2
              : 3;
  }
  private temp(n: number) {
    return n <= 35 ? 3 : n <= 36 ? 1 : n <= 38 ? 0 : n <= 39 ? 1 : 2;
  }
}
