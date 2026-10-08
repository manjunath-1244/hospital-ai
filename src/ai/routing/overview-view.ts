import type { OverviewMetric } from './intent';

/** Deterministic text for hospital-wide numbers (exact and instant; no model needed for a count). */
export function renderOverview(o: any, metrics: OverviewMetric[] = []): string {
  const all: Record<OverviewMetric, string[]> = {
    patients: [`• Total patients: ${o.totalPatients}`],
    waiting: [
      `• Waiting for triage: ${o.waitingForTriage}`,
      `• Waiting for a doctor: ${o.waitingForDoctor}${o.waitingForDoctor + o.waitingForTriage ? ` (longest wait in the waiting room ${o.longestWaitMinutes} min)` : ''}`,
    ],
    withDoctor: [`• With a doctor now: ${o.withDoctor}`],
    completedToday: [`• Completed today: ${o.completedToday}`],
    criticalLabs: [
      `• Critical lab results in the last 24 hours: ${o.criticalLabsLast24h}`,
    ],
    tasks: [`• Pending staff tasks: ${o.pendingStaffTasks}`],
    appointments: [`• Scheduled appointments: ${o.scheduledAppointments}`],
  };
  const order = Object.keys(all) as OverviewMetric[];
  // An explicit question gets only the numbers it asked for; "overview" gets everything.
  if (metrics.length)
    return [
      'Hospital numbers:',
      ...order.filter((m) => metrics.includes(m)).flatMap((m) => all[m]),
    ].join('\n');
  return [
    'Hospital overview:',
    ...[
      'patients',
      'waiting',
      'withDoctor',
      'completedToday',
      'criticalLabs',
      'tasks',
      'appointments',
    ].flatMap((m) => all[m as OverviewMetric]),
  ].join('\n');
}

/** A count question about something the system does not record: say so, and say what can be counted. */
export function renderUnsupportedCount(noun: string | null): string {
  return `I do not keep a count of ${noun ? `"${noun}"` : 'that'} in this system. I can tell you: total patients, patients waiting (for triage or a doctor), patients with a doctor, completed today, critical lab results, pending tasks, scheduled appointments, and how many specialists or staff there are.`;
}
