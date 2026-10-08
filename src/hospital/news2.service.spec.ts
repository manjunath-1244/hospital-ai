import { News2Service, VitalsInput } from './news2.service';

const normal: VitalsInput = {
  respiratoryRate: 16,
  spO2: 97,
  onSupplementalO2: false,
  bpSystolic: 120,
  heartRate: 70,
  consciousness: 'ALERT',
  tempCelsius: 37,
};

describe('News2Service', () => {
  const svc = new News2Service();

  it('scores a normal patient 0 / LOW', () => {
    const r = svc.calculate(normal);
    expect(r.score).toBe(0);
    expect(r.riskLevel).toBe('LOW');
    expect(r.escalate).toBe(false);
  });

  it('scores each RCP band correctly', () => {
    expect(
      svc.calculate({ ...normal, respiratoryRate: 8 }).breakdown
        .respiratoryRate,
    ).toBe(3);
    expect(
      svc.calculate({ ...normal, respiratoryRate: 22 }).breakdown
        .respiratoryRate,
    ).toBe(2);
    expect(svc.calculate({ ...normal, spO2: 92 }).breakdown.spO2).toBe(2);
    expect(
      svc.calculate({ ...normal, onSupplementalO2: true }).breakdown
        .supplementalO2,
    ).toBe(2);
    expect(
      svc.calculate({ ...normal, bpSystolic: 95 }).breakdown.systolicBp,
    ).toBe(2);
    expect(
      svc.calculate({ ...normal, bpSystolic: 220 }).breakdown.systolicBp,
    ).toBe(3);
    expect(
      svc.calculate({ ...normal, heartRate: 120 }).breakdown.heartRate,
    ).toBe(2);
    expect(
      svc.calculate({ ...normal, consciousness: 'CONFUSION' }).breakdown
        .consciousness,
    ).toBe(3);
    expect(
      svc.calculate({ ...normal, tempCelsius: 39.5 }).breakdown.temperature,
    ).toBe(2);
  });

  it('SpO2 scale 2 treats 88-92% as normal and high saturation on oxygen as abnormal', () => {
    expect(
      svc.calculate({ ...normal, spO2: 90, spo2Scale2: true }).breakdown.spO2,
    ).toBe(0);
    expect(
      svc.calculate({
        ...normal,
        spO2: 98,
        onSupplementalO2: true,
        spo2Scale2: true,
      }).breakdown.spO2,
    ).toBe(3);
  });

  it('escalates on aggregate >= 5 and on any single parameter of 3', () => {
    const single = svc.calculate({ ...normal, heartRate: 140 });
    expect(single.score).toBe(3);
    expect(single.riskLevel).toBe('LOW_MEDIUM');
    expect(single.escalate).toBe(true);

    const medium = svc.calculate({
      ...normal,
      heartRate: 120,
      respiratoryRate: 22,
      tempCelsius: 39.5,
    });
    expect(medium.score).toBe(6);
    expect(medium.riskLevel).toBe('MEDIUM');

    expect(
      svc.calculate({
        ...normal,
        respiratoryRate: 26,
        spO2: 90,
        bpSystolic: 88,
      }).riskLevel,
    ).toBe('HIGH');
  });

  it('detects SIRS with two criteria', () => {
    expect(
      svc.sirs({ tempCelsius: 38.6, heartRate: 100, respiratoryRate: 16 }),
    ).toMatchObject({ count: 2, positive: true });
    expect(
      svc.sirs({ tempCelsius: 37, heartRate: 70, respiratoryRate: 16 })
        .positive,
    ).toBe(false);
  });

  it('suggests ESI 1 for unresponsive and ESI 5 for stable', () => {
    expect(
      svc.assess({ ...normal, consciousness: 'UNRESPONSIVE' })
        .suggestedEsiLevel,
    ).toBe(1);
    expect(svc.assess(normal).suggestedEsiLevel).toBe(5);
  });
});
