'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, ChevronDown, ChevronRight } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import { fmtSlot, type AvailabilityResponse, type Specialist } from '../../lib/specialists';
import { ErrorBox, Loading, SuccessBox } from './common';
import { Button, Card, Field, Select, Textarea, cx } from './kit';
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
    <Card as="div" data-testid="appointment-booking">
      <h2 className="text-lg font-semibold text-ink">
        <button
          type="button"
          onClick={() => collapsible && setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-h-10 w-full items-center gap-2 rounded-lg text-left"
        >
          <CalendarPlus className="h-5 w-5 text-brand-600" aria-hidden />
          Book appointment
          {collapsible && (open ? <ChevronDown className="ml-auto h-5 w-5 text-ink-3" aria-hidden /> : <ChevronRight className="ml-auto h-5 w-5 text-ink-3" aria-hidden />)}
        </button>
      </h2>

      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <p className="text-sm text-ink-3">The patient needs an open visit. Slots are shown in your local time.</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <PatientPicker value={patientId} onChange={(id) => { setPatientId(id); setSuccess(''); }} />
            <Field label="Specialty">
              {(id) => (
                <Select id={id} value={specialty} onChange={(e) => pickSpecialty(e.target.value)}>
                  <option value="">Select a specialty</option>
                  {specialties.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Specialist">
              {(id) => (
                <Select id={id} value={doctorId} onChange={(e) => pickDoctor(e.target.value)} disabled={!specialty}>
                  <option value="">{specialty ? 'Select a specialist' : 'Choose a specialty first'}</option>
                  {specialists.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.isAvailable ? '' : ' (unavailable)'}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {doctorId && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink" id="booking-slots-label">Free slots</p>
              {slotsLoading && <Loading text="Loading slots..." />}
              {!slotsLoading && slots.length === 0 && <p className="text-sm text-ink-3">No free slots for this specialist.</p>}
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby="booking-slots-label">
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlot(s)}
                    aria-pressed={slot === s}
                    className={cx(
                      'min-h-10 rounded-lg border px-3 text-sm font-semibold',
                      slot === s ? 'border-brand-700 bg-brand-700 text-white' : 'border-line-strong bg-surface text-ink hover:bg-surface-muted',
                    )}
                  >
                    {fmtSlot(s)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Field label="Reason">
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>

          <SuccessBox message={success} />
          <ErrorBox message={error} />
          <Button type="button" disabled={!ready || booking} loading={booking} onClick={book} data-testid="appointment-book">
            {booking ? 'Booking...' : 'Book appointment'}
          </Button>
        </div>
      )}
    </Card>
  );
};
