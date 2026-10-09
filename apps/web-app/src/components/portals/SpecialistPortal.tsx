'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRole } from '../../context/RoleContext';
import { SpecialistConsultations } from './SpecialistConsultations';
import { apiFetch, errorMessage } from '../../lib/api';
import { WEEKDAYS, fmtSlot, type AppointmentRow, type AvailabilityResponse, type Specialist } from '../../lib/specialists';
import { ErrorBox, Loading, fmtTime } from '../ui/common';
import { Badge, Button, Card, EmptyState, Field, PageHeader, SectionTitle, Select, TableFrame } from '../ui/kit';

export const SpecialistPortal: React.FC = () => {
  const { user } = useAuth();
  const [me, setMe] = useState<Specialist | null>(null);
  const [avail, setAvail] = useState<AvailabilityResponse | null>(null);
  const { ownRole } = useRole();
  const [appts, setAppts] = useState<AppointmentRow[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // An admin viewing this portal is not a specialist: they pick whose portal to look at.
  const [all, setAll] = useState<Specialist[]>([]);
  const [chosen, setChosen] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    const errs: string[] = [];
    let list: Specialist[] = [];
    try {
      list = await apiFetch<Specialist[]>('/hospital/specialists');
      setAll(list);
    } catch (e) {
      errs.push(errorMessage(e));
    }
    const id = ownRole === 'ADMIN' ? (chosen || list[0]?.id || '') : user.id;
    if (ownRole === 'ADMIN' && !chosen && id) setChosen(id);
    if (!id) {
      setError(errs.join('; ') || (ownRole === 'ADMIN' ? 'No specialists exist yet.' : ''));
      return;
    }
    setMe(list.find((s) => s.id === id) ?? null);
    const [av, ap] = await Promise.allSettled([
      apiFetch<AvailabilityResponse>(`/hospital/specialists/${encodeURIComponent(id)}/availability?limit=12`),
      apiFetch<AppointmentRow[]>('/hospital/appointments'),
    ]);
    if (av.status === 'fulfilled') setAvail(av.value);
    else errs.push(errorMessage(av.reason));
    if (ap.status === 'fulfilled') setAppts(ap.value.filter((a) => a.doctorId === id));
    else errs.push(errorMessage(ap.reason));
    setError(errs.join('; '));
  }, [user, ownRole, chosen]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggle = async () => {
    if (!user || !me) return;
    setSaving(true);
    try {
      await apiFetch(`/hospital/specialists/${encodeURIComponent(me.id)}/availability`, { method: 'PATCH', body: { isAvailable: !me.isAvailable } });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const hours = [...(avail?.weeklyHours ?? [])].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  const upcoming = [...(appts ?? [])].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  const dept = me?.department ?? user?.department;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Stethoscope className="h-6 w-6" />}
        title={ownRole === 'ADMIN' ? (me?.name ?? 'Specialist') : (user?.displayName ?? 'Specialist')}
        subtitle={`${me?.specialty ?? user?.specialty ?? '—'}${dept ? ` • ${dept}` : ''}`}
        actions={
          me && (
            <Button
              variant="secondary"
              onClick={toggle}
              loading={saving}
              aria-pressed={me.isAvailable}
              data-testid="specialist-availability-toggle"
            >
              {me.isAvailable ? 'Available for bookings' : 'Not available'} (click to change)
            </Button>
          )
        }
      />

      {ownRole === 'ADMIN' && all.length > 0 && (
        <Field label="Viewing the portal of" className="max-w-md">
          {(id) => (
            <Select id={id} data-testid="specialist-select" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {all.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name} — {sp.specialty}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <ErrorBox message={error} />
      {!avail && !error && <Loading />}

      <SpecialistConsultations />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle hint="Weekly hours are in UTC.">Weekly hours</SectionTitle>
          {hours.length === 0 ? (
            <EmptyState title="No weekly hours set." hint="Hours appear here once they are scheduled for this specialist." />
          ) : (
            <ul className="space-y-2 text-sm text-ink">
              {hours.map((h, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 rounded-lg border border-line bg-surface-muted px-4 py-2.5">
                  <span className="font-semibold">{WEEKDAYS[h.weekday] ?? h.weekday}</span>
                  <span className="tabular-nums text-ink-2">{h.startTime} – {h.endTime} ({h.slotMinutes} min slots)</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle hint="Shown in your local time.">Next free slots</SectionTitle>
          {avail && avail.slots.length === 0 && <EmptyState title="No free slots." hint="Open slots are listed here when hours are set and not fully booked." />}
          <ul className="flex flex-wrap gap-2">
            {avail?.slots.map((s) => (
              <li key={s}>
                <Badge tone="neutral" className="px-3 py-1.5 text-sm">{fmtSlot(s)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <SectionTitle>My upcoming appointments</SectionTitle>
        {appts && upcoming.length === 0 && <EmptyState title="No appointments booked." hint="Booked appointments for this specialist will be listed here." />}
        {upcoming.length > 0 && (
          <TableFrame>
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th><th scope="col">Patient</th><th scope="col">Reason</th><th scope="col">Booking</th><th scope="col">Visit</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((a, i) => (
                  <tr key={a.id ?? i}>
                    <td className="whitespace-nowrap">{fmtTime(a.dateTime)}</td>
                    <td><span className="font-semibold">{a.patientName ?? 'Unknown'}</span> <span className="text-xs text-ink-3">{a.patientId ?? ''}</span></td>
                    <td>{a.reason ?? '—'}</td>
                    <td>{a.status}</td>
                    <td>{a.visitStatus ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}
      </Card>
    </div>
  );
};
