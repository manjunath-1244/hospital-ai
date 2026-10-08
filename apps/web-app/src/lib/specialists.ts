/** Shapes and helpers for the specialist / appointment-booking backend feature. */
export interface Specialist {
  id: string;
  name: string;
  role: string;
  specialty: string | null;
  department: string | null;
  isAvailable: boolean;
}

export interface WeeklyHours {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "HH:mm", UTC
  endTime: string;
  slotMinutes: number;
}

export interface AvailabilityResponse {
  doctor: Specialist | Record<string, unknown>;
  slots: string[]; // ISO date-times
  weeklyHours: WeeklyHours[];
}

export interface AppointmentRow {
  id?: string;
  patientId?: string;
  patientName?: string;
  doctorId?: string | null;
  doctorName?: string | null;
  department?: string | null;
  dateTime: string;
  status: string;
  reason?: string | null;
  patientAge?: number;
  patientGender?: string;
  visitStatus?: string | null;
  chiefComplaint?: string | null;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Slot time in the viewer's local timezone. */
export const fmtSlot = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
