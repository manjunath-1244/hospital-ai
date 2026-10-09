'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Shield, Cpu, RefreshCw } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import { useRealtime } from '../../context/RoleContext';
import { statusLabel, type VisitStatus } from '../../lib/visits';
import type { AuditLogEntry, HealthResponse, OverviewResponse } from '../../lib/types';
import { AgentObservability } from './AgentObservability';
import { KnowledgeBasePanel } from './KnowledgeBasePanel';
import { PatientManagementPanel } from './PatientManagementPanel';
import { PendingActionsPanel } from './PendingActionsPanel';
import { SpecialistsCard } from './SpecialistsCard';
import { ErrorBox, Loading, fmtTime } from '../ui/common';
import { Badge, Button, Card, EmptyState, PageHeader, SectionTitle, StatTile, TableFrame, type Tone } from '../ui/kit';

export const AdminPortal: React.FC = () => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState('');
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [logsError, setLogsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [h, l] = await Promise.allSettled([
      apiFetch<HealthResponse>('/admin/health'),
      apiFetch<AuditLogEntry[]>('/admin/audit-logs?limit=100'),
    ]);
    if (h.status === 'fulfilled') {
      setHealth(h.value);
      setHealthError('');
    } else setHealthError(errorMessage(h.reason));
    if (l.status === 'fulfilled') {
      setLogs(l.value);
      setLogsError('');
    } else setLogsError(errorMessage(l.reason));
    setLoading(false);
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await apiFetch<OverviewResponse>('/hospital/overview'));
      setOverviewError('');
    } catch (e) {
      setOverviewError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    loadOverview();
  }, [load, loadOverview]);
  useRealtime(['visit.updated', 'patient.registered', 'patient.deleted', 'alert.critical_lab'], loadOverview);

  const tiles: { label: string; value: number | string; tone?: Tone }[] = overview
    ? [
        { label: 'Total patients', value: overview.totalPatients },
        { label: 'Active visits', value: overview.activeVisits },
        { label: 'Waiting for triage', value: overview.waitingForTriage, tone: overview.waitingForTriage ? 'warning' : undefined },
        { label: 'Waiting for doctor', value: overview.waitingForDoctor, tone: overview.waitingForDoctor ? 'warning' : undefined },
        { label: 'With doctor', value: overview.withDoctor },
        { label: 'Completed today', value: overview.completedToday, tone: 'success' },
        { label: 'Longest wait', value: `${overview.longestWaitMinutes} min`, tone: overview.longestWaitMinutes >= 30 ? 'danger' : undefined },
        { label: 'Critical labs (24h)', value: overview.criticalLabsLast24h, tone: overview.criticalLabsLast24h ? 'danger' : undefined },
        { label: 'Pending staff tasks', value: overview.pendingStaffTasks },
        { label: 'Scheduled appointments', value: overview.scheduledAppointments },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Shield className="h-6 w-6" />}
        title="Administration: Service Health & Audit Log"
        subtitle={`Live data from the backend.${health ? ` Last checked ${fmtTime(health.checkedAt)}.` : ''}`}
        actions={
          <Button variant="secondary" onClick={load} loading={loading} icon={<RefreshCw className="h-4 w-4" />} data-testid="admin-refresh">
            Refresh
          </Button>
        }
      />

      <Card>
        <SectionTitle>Hospital Overview</SectionTitle>
        <div className="space-y-4">
          {!overview && !overviewError && <Loading text="Loading overview..." />}
          <ErrorBox message={overviewError} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {tiles.map((t) => (
              <StatTile key={t.label} label={t.label} value={t.value} tone={t.tone} />
            ))}
          </div>
          {overview && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(overview.visitsByStatus).map(([k, n]) => (
                <Badge key={k}>
                  {statusLabel(k as VisitStatus)}: <span className="font-semibold text-ink">{n}</span>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <SectionTitle icon={<Cpu className="h-5 w-5" />}>Service Health</SectionTitle>
        <div className="space-y-4">
          {loading && !health && <Loading text="Checking services..." />}
          <ErrorBox message={healthError} />
          {health && health.services.length === 0 && <EmptyState title="No services reported" hint="The backend returned no service checks. Try Refresh." />}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {health?.services.map((s) => (
              <div key={s.name} className="space-y-2 rounded-lg border border-line bg-surface-muted p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{s.name}</span>
                  <Badge tone={s.status === 'UP' ? 'success' : 'danger'}>{s.status}</Badge>
                </div>
                <p className="break-words text-ink-3">{s.details}</p>
                <p className="font-mono text-xs text-ink-2">Latency: {s.latencyMs} ms</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Audit Log (latest 100)</SectionTitle>
        <div className="space-y-4">
          {loading && !logs && <Loading text="Loading audit log..." />}
          <ErrorBox message={logsError} />
          {logs && logs.length === 0 && <EmptyState title="No audit entries" hint="Requests made to the system will be recorded here." />}
          {logs && logs.length > 0 && (
            <TableFrame>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Role</th>
                    <th scope="col">User</th>
                    <th scope="col">Request</th>
                    <th scope="col">Patient</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs">
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap">{fmtTime(l.at)}</td>
                      <td>{l.role}</td>
                      <td className="break-all">{l.userId}</td>
                      <td className="break-all"><span className="font-semibold">{l.method}</span> {l.path}</td>
                      <td className="break-all">{l.patientId ?? '—'}</td>
                      <td>
                        <Badge tone={l.statusCode >= 400 ? 'danger' : 'success'}>{l.statusCode}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          )}
        </div>
      </Card>

      <PendingActionsPanel />

      <SpecialistsCard />

      <KnowledgeBasePanel />
      <PatientManagementPanel />

      <AgentObservability />
    </div>
  );
};
