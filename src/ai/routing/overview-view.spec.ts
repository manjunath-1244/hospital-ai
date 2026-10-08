import { renderOverview } from './overview-view';

describe('renderOverview', () => {
  it('shows every number from the data', () => {
    const t = renderOverview({
      totalPatients: 8,
      waitingForDoctor: 2,
      seen: 5,
      closed: 1,
      longestWaitMinutes: 42,
      criticalLabsLast24h: 0,
      pendingStaffTasks: 3,
      scheduledAppointments: 4,
    });
    expect(t).toContain('Total patients: 8');
    expect(t).toContain('Waiting for a doctor: 2 (longest wait 42 min)');
    expect(t).toContain('Closed sessions: 1');
    expect(t).toContain('Scheduled appointments: 4');
  });
  it('omits the wait time when nobody is waiting', () => {
    expect(
      renderOverview({
        totalPatients: 1,
        waitingForDoctor: 0,
        seen: 1,
        closed: 0,
        longestWaitMinutes: 0,
        criticalLabsLast24h: 0,
        pendingStaffTasks: 0,
        scheduledAppointments: 0,
      }),
    ).not.toContain('longest wait');
  });
});
