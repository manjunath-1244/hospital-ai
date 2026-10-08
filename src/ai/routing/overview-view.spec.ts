import { renderOverview } from './overview-view';

const base = {
  totalPatients: 8,
  waitingForTriage: 1,
  waitingForDoctor: 2,
  withDoctor: 3,
  completedToday: 4,
  longestWaitMinutes: 42,
  criticalLabsLast24h: 0,
  pendingStaffTasks: 3,
  scheduledAppointments: 4,
};

describe('renderOverview', () => {
  it('shows every number from the data', () => {
    const t = renderOverview(base);
    expect(t).toContain('Total patients: 8');
    expect(t).toContain('Waiting for triage: 1');
    expect(t).toContain(
      'Waiting for a doctor: 2 (longest wait in the waiting room 42 min)',
    );
    expect(t).toContain('With a doctor now: 3');
    expect(t).toContain('Completed today: 4');
    expect(t).toContain('Scheduled appointments: 4');
  });
  it('omits the wait time when nobody is waiting', () => {
    expect(
      renderOverview({ ...base, waitingForTriage: 0, waitingForDoctor: 0 }),
    ).not.toContain('longest wait');
  });
});
