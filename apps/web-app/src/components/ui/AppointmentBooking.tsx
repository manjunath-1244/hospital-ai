'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, ChevronDown, ChevronRight } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import { fmtSlot, type AvailabilityResponse, type Specialist } from '../../lib/specialists';
import { ErrorBox, Loading, SuccessBox, inputCls, labelCls } from './common';
import { PatientPicker } from './PatientPicker';

/** Patient -> specialty -> specialist -> free slot -> reason -> book. Everything is loaded from the API. */
export const AppointmentBooking: React.FC<{ collapsible?: boolean }> = ({ collapsible }) => {
  const [open, setOpen] = useState(!collapsible);
  const [patientId, setPatientId] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialty, setSpecialty] = useState('');
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState('');
  const [reason, setReason] = useState('');
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!open || specialties.length) return;
    apiFetch<string[]>('/hospital/specialties')
      .then(setSpecialties)
      .catch((e) => setError(errorMessage(e)));
  }, [open, specialties.length]);

  useEffect(() => {
    if (!specialty) return;
    let cancelled = false;
    apiFetch<Specialist[]>(`/hospital/specialists?specialty=${encodeURIComponent(specialty)}`)
      .then((r) => !cancelled && setSpecialists(r))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [specialty]);

  const loadSlots = useCallback(async (id: string) => {
    if (!id) return;
    setSlotsLoading(true);
    try {
      const r = await apiFetch<AvailabilityResponse>(`/hospital/specialists/${encodeURIComponent(id)}/availability?limit=24`);
      setSlots(r.slots);
    } catch (e) {
      setSlots([]);
      setError(errorMessage(e));
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  const pickSpecialty = (s: string) => {
    setSpecialty(s);
    setSpecialists([]);
    setDoctorId('');
    setSlots([]);
    setSlot('');
  };
  const pickDoctor = (id: string) => {
    setDoctorId(id);
    setSlot('');
    setSlots([]);
    setError('');
    loadSlots(id);
  };

  const book = async () => {
    setBooking(true);
    setError('');
    setSuccess('');
    try {
      await apiFetch('/hospital/appointments', {
        method: 'POST',
        body: { patientId, doctorId, dateTime: slot, reason: reason.trim() },
      });
      const doc = specialists.find((s) => s.id === doctorId);
      setSuccess(`Appointment booked with ${doc?.name ?? 'the specialist'} on ${fmtSlot(slot)}.`);
      setSlot('');
      setReason('');
      loadSlots(doctorId);
    } catch (e) {
      setError(errorMessage(e));
      loadSlots(doctorId);
    } finally {
      setBooking(false);
    }
  };

  const ready = patientId && doctorId && slot && reason.trim();

  return (
    <div data-testid="appointment-booking" className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
      <button
        type="button"
        onClick={() => collapsible && setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-left text-xl font-semibold text-white tracking-tight"
      >
        <CalendarPlus className="h-5 w-5 text-teal-400" />
        Book appointment
        {collapsible && (open ? <ChevronDown className="h-5 w-5 ml-auto text-slate-400" /> : <ChevronRight className="h-5 w-5 ml-auto text-slate-400" />)}
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-700 pt-4">
          <p className="text-sm text-slate-400">The patient needs an open visit. Slots are shown in your local time.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <PatientPicker value={patientId} onChange={(id) => { setPatientId(id); setSuccess(''); }} />
            <div>
              <label className={labelCls}>Specialty</label>
              <select value={specialty} onChange={(e) => pickSpecialty(e.target.value)} className={inputCls}>
                <option value="">Select a specialty</option>
                {specialties.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Specialist</label>
              <select value={doctorId} onChange={(e) => pickDoctor(e.target.value)} className={inputCls} disabled={!specialty}>
                <option value="">{specialty ? 'Select a specialist' : 'Choose a specialty first'}</option>
                {specialists.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.isAvailable ? '' : ' (unavailable)'}</option>
                ))}
              </select>
            </div>
          </div>

          {doctorId && (
            <div>
              <label className={labelCls}>Free slots</label>
              {slotsLoading && <Loading text="Loading slots..." />}
              {!slotsLoading && slots.length === 0 && <p className="text-sm text-slate-400">No free slots for this specialist.</p>}
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlot(s)}
                    aria-pressed={slot === s}
                    className={`rounded-lg px-3 py-2 text-sm font-bold border ${slot === s ? 'bg-teal-600 border-teal-400 text-white' : 'bg-slate-950 border-slate-700 text-slate-300 hover:text-white'}`}
                  >
                    {fmtSlot(s)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>Reason</label>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
          </div>

          <SuccessBox message={success} />
          <ErrorBox message={error} />
          <button
            type="button"
            disabled={!ready || booking}
            onClick={book}
            className="rounded-xl min-h-12 bg-teal-600 hover:bg-teal-500 px-6 py-3 text-base font-bold text-white disabled:opacity-50"
          >
            {booking ? 'Booking...' : 'Book appointment'}
          </button>
        </div>
      )}
    </div>
  );
};
