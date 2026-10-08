/** Deterministic text for hospital-wide numbers (exact and instant; no model needed for a count). */
export function renderOverview(o: any): string {
  const lines = [
    `Hospital overview:`,
    `• Total patients: ${o.totalPatients}`,
    `• Waiting for a doctor: ${o.waitingForDoctor}${o.waitingForDoctor ? ` (longest wait ${o.longestWaitMinutes} min)` : ''}`,
    `• Seen: ${o.seen}`,
    `• Closed sessions: ${o.closed}`,
    `• Critical lab results in the last 24 hours: ${o.criticalLabsLast24h}`,
    `• Pending staff tasks: ${o.pendingStaffTasks}`,
    `• Scheduled appointments: ${o.scheduledAppointments}`,
  ];
  return lines.join('\n');
}
