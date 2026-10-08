/** Deterministic text for hospital-wide numbers (exact and instant; no model needed for a count). */
export function renderOverview(o: any): string {
  const lines = [
    `Hospital overview:`,
    `• Total patients: ${o.totalPatients}`,
    `• Waiting for triage: ${o.waitingForTriage}`,
    `• Waiting for a doctor: ${o.waitingForDoctor}${o.waitingForDoctor + o.waitingForTriage ? ` (longest wait in the waiting room ${o.longestWaitMinutes} min)` : ''}`,
    `• With a doctor now: ${o.withDoctor}`,
    `• Completed today: ${o.completedToday}`,
    `• Critical lab results in the last 24 hours: ${o.criticalLabsLast24h}`,
    `• Pending staff tasks: ${o.pendingStaffTasks}`,
    `• Scheduled appointments: ${o.scheduledAppointments}`,
  ];
  return lines.join('\n');
}
