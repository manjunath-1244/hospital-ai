import { toVisitSummary } from './visit-summary';

const base: any = {
  id: 'V1',
  patientId: 'P1',
  status: 'WAITING_TRIAGE',
  chiefComplaint: 'chest pain',
  priority: null,
  department: null,
  primaryDoctorId: null,
  primaryDoctorName: null,
  arrivedAt: new Date('2026-10-08T10:00:00Z'),
  triagedAt: null,
  consultationStartedAt: null,
  completedAt: null,
  waitAlertedAt: null,
  outcome: null,
  closeReason: null,
  createdBy: 'x',
};

describe('toVisitSummary', () => {
  const now = new Date('2026-10-08T10:42:30Z').getTime();
  it('reports wait minutes only while waiting', () => {
    expect(toVisitSummary(base, now).waitMinutes).toBe(42);
    expect(
      toVisitSummary({ ...base, status: 'TRIAGED' }, now).waitMinutes,
    ).toBe(42);
    expect(
      toVisitSummary({ ...base, status: 'IN_CONSULTATION' }, now).waitMinutes,
    ).toBeNull();
    expect(
      toVisitSummary({ ...base, status: 'COMPLETED' }, now).waitMinutes,
    ).toBeNull();
  });
  it('adds a human label and ISO dates', () => {
    const s = toVisitSummary(
      {
        ...base,
        status: 'TRIAGED',
        triagedAt: new Date('2026-10-08T10:20:00Z'),
      },
      now,
    );
    expect(s.statusLabel).toBe('Waiting for doctor');
    expect(s.arrivedAt).toBe('2026-10-08T10:00:00.000Z');
    expect(s.triagedAt).toBe('2026-10-08T10:20:00.000Z');
  });
  it('never returns a negative wait', () => {
    expect(
      toVisitSummary(base, new Date('2026-10-08T09:00:00Z').getTime())
        .waitMinutes,
    ).toBe(0);
  });
});
