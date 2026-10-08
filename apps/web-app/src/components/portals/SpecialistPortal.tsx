'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRole } from '../../context/RoleContext';
import { SpecialistConsultations } from './SpecialistConsultations';
import { apiFetch, errorMessage } from '../../lib/api';
import { WEEKDAYS, fmtSlot, type AppointmentRow, type AvailabilityResponse, type Specialist } from '../../lib/specialists';
import { Empty, ErrorBox, Loading, fmtTime } from '../ui/common';

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

  const card = 'glass-panel p-7 rounded-2xl border border-slate-700 space-y-4';
  const h3 = 'text-xl font-semibold text-white tracking-tight border-b border-slate-700 pb-4';
  const hours = [...(avail?.weeklyHours ?? [])].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  const upcoming = [...(appts ?? [])].sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-2xl glass-panel p-7 border-l-4 border-l-teal-500">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <Stethoscope className="h-8 w-8 text-teal-400" />
            {ownRole === 'ADMIN' ? (me?.name ?? 'Specialist') : (user?.displayName ?? 'Specialist')}
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

      {ownRole === 'ADMIN' && all.length > 0 && (
        <label className="flex items-center gap-3 text-base text-slate-200">
          Viewing the portal of
          <select
            data-testid="specialist-select"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            className="rounded-xl bg-slate-950 border border-slate-700 px-4 py-2 min-h-12"
          >
            {all.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name} — {sp.specialty}
              </option>
            ))}
          </select>
        </label>
      )}

      <ErrorBox message={error} />
      {!avail && !error && <Loading />}

      <SpecialistConsultations />

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
            <table className="w-full text-left text-base">
              <thead>
                <tr className="border-b border-slate-800 text-sm text-slate-400 font-semibold uppercase tracking-wider">
                  <th className="pb-2 px-2">When</th><th className="pb-2 px-2">Patient</th><th className="pb-2 px-2">Reason</th><th className="pb-2 px-2">Booking</th><th className="pb-2 px-2">Visit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {upcoming.map((a, i) => {
                  return (
                    <tr key={a.id ?? i}>
                      <td className="py-2 px-2 whitespace-nowrap">{fmtTime(a.dateTime)}</td>
                      <td className="py-2 px-2"><span className="font-bold">{a.patientName ?? 'Unknown'}</span> <span className="font-mono text-sm text-slate-400">{a.patientId ?? ''}</span></td>
                      <td className="py-2 px-2">{a.reason ?? '—'}</td>
                      <td className="py-2 px-2">{a.status}</td>
                      <td className="py-2 px-2">{a.visitStatus ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
