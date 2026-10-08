'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, errorMessage } from '../../lib/api';
import { WEEKDAYS, fmtSlot, type AppointmentRow, type AvailabilityResponse, type Specialist } from '../../lib/specialists';
import { Empty, ErrorBox, Loading, fmtTime } from '../ui/common';

export const SpecialistPortal: React.FC = () => {
  const { user } = useAuth();
  const [me, setMe] = useState<Specialist | null>(null);
  const [avail, setAvail] = useState<AvailabilityResponse | null>(null);
  const [appts, setAppts] = useState<AppointmentRow[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [sp, av, ap] = await Promise.allSettled([
      apiFetch<Specialist[]>('/hospital/specialists'),
      apiFetch<AvailabilityResponse>(`/hospital/specialists/${encodeURIComponent(user.id)}/availability?limit=12`),
      apiFetch<AppointmentRow[]>('/hospital/appointments'),
    ]);
    const errs: string[] = [];
    if (sp.status === 'fulfilled') setMe(sp.value.find((s) => s.id === user.id) ?? null);
    else errs.push(errorMessage(sp.reason));
    if (av.status === 'fulfilled') setAvail(av.value);
    else errs.push(errorMessage(av.reason));
    if (ap.status === 'fulfilled') setAppts(ap.value.filter((a) => a.doctorId === user.id));
    else errs.push(errorMessage(ap.reason));
    setError(errs.join('; '));
  }, [user]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggle = async () => {
    if (!user || !me) return;
    setSaving(true);
    try {
      await apiFetch(`/hospital/specialists/${encodeURIComponent(user.id)}/availability`, { method: 'PATCH', body: { isAvailable: !me.isAvailable } });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const card = 'glass-panel p-7 rounded-2xl border border-slate-700 space-y-4';
  const h3 = 'text-xl font-semibold text-white tracking-tight border-b border-slate-700 pb-4';
  const hours = [...(avail?.weeklyHours ?? [])].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  const upcoming = (appts ?? []).sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-2xl glass-panel p-7 border-l-4 border-l-teal-500">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <Stethoscope className="h-8 w-8 text-teal-400" />
            {user?.displayName ?? 'Specialist'}
          </h2>
          <p className="text-base text-slate-300 mt-1.5">
            {me?.specialty ?? user?.specialty ?? '—'}{(me?.department ?? user?.department) ? ` • ${me?.department ?? user?.department}` : ''}
          </p>
        </div>
        {me && (
          <button
            type="button"
            onClick={toggle}
            disabled={saving}
            aria-pressed={me.isAvailable}
            className={`rounded-xl min-h-12 border px-5 py-2 text-base font-bold disabled:opacity-50 ${me.isAvailable ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-700/40 text-slate-300 border-slate-600'}`}
          >
            {me.isAvailable ? 'Available for bookings' : 'Not available'} (click to change)
          </button>
        )}
      </div>

      <ErrorBox message={error} />
      {!avail && !appts && !error && <Loading />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={card}>
          <h3 className={h3}>Weekly hours</h3>
          {hours.length === 0 ? (
            <Empty text="No weekly hours set." />
          ) : (
            <ul className="space-y-2 text-base text-slate-200">
              {hours.map((h, i) => (
                <li key={i} className="flex justify-between rounded-xl bg-slate-950 border border-slate-700 px-4 py-2">
                  <span className="font-bold">{WEEKDAYS[h.weekday] ?? h.weekday}</span>
                  <span className="font-mono">{h.startTime} – {h.endTime} ({h.slotMinutes} min slots)</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-slate-400">Weekly hours are in UTC.</p>
        </div>

        <div className={card}>
          <h3 className={h3}>Next free slots</h3>
          {avail && avail.slots.length === 0 && <Empty text="No free slots." />}
          <div className="flex flex-wrap gap-2">
            {avail?.slots.map((s) => (
              <span key={s} className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm font-bold text-slate-200">{fmtSlot(s)}</span>
            ))}
          </div>
          <p className="text-sm text-slate-400">Shown in your local time.</p>
        </div>
      </div>

      <div className={card}>
        <h3 className={h3}>My upcoming appointments</h3>
        {appts && upcoming.length === 0 && <Empty text="No appointments booked." />}
        {upcoming.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                  <th className="pb-2 px-2">When</th><th className="pb-2 px-2">Patient</th><th className="pb-2 px-2">Reason</th><th className="pb-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {upcoming.map((a, i) => (
                  <tr key={a.id ?? i}>
                    <td className="py-2 px-2 whitespace-nowrap">{fmtTime(a.dateTime)}</td>
                    <td className="py-2 px-2">{a.patientName ?? a.patientId ?? '—'}</td>
                    <td className="py-2 px-2">{a.reason ?? '—'}</td>
                    <td className="py-2 px-2">{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-slate-400">Referrals will appear here later.</p>
      </div>
    </div>
  );
};
