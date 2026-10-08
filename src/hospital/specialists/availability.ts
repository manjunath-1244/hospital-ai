/**
 * Appointment slots from weekly working hours. Pure functions (no database, no clock of their own) so the rules are
 * easy to test. All times are UTC; a hospital in another zone enters its hours in UTC (documented limitation).
 */
export interface WeeklyWindow {
  /** 0 = Sunday … 6 = Saturday (UTC). */
  weekday: number;
  /** `HH:mm`, inclusive. */
  startTime: string;
  /** `HH:mm`, exclusive: the last slot must end by this time. */
  endTime: string;
  slotMinutes: number;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function isValidWindow(w: WeeklyWindow): boolean {
  return (
    Number.isInteger(w.weekday) &&
    w.weekday >= 0 &&
    w.weekday <= 6 &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(w.startTime) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(w.endTime) &&
    toMinutes(w.endTime) > toMinutes(w.startTime) &&
    Number.isInteger(w.slotMinutes) &&
    w.slotMinutes >= 5 &&
    w.slotMinutes <= 240
  );
}

/** Canonical form used to compare a requested time with stored appointments. */
export const slotKey = (dateTime: string | Date): string =>
  new Date(dateTime).toISOString();

/**
 * Free slots between `from` and `to` (both inclusive of whole days in UTC), skipping slots in the past
 * and slots already booked. Sorted ascending, at most `limit`.
 */
export function generateSlots(
  windows: WeeklyWindow[],
  range: { from: Date; to: Date; now: Date },
  bookedKeys: ReadonlySet<string>,
  limit = 50,
): string[] {
  const out: string[] = [];
  const day = new Date(
    Date.UTC(
      range.from.getUTCFullYear(),
      range.from.getUTCMonth(),
      range.from.getUTCDate(),
    ),
  );
  for (
    ;
    day.getTime() <= range.to.getTime() && out.length < limit;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const todays = windows
      .filter((w) => w.weekday === day.getUTCDay() && isValidWindow(w))
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    for (const w of todays) {
      for (
        let m = toMinutes(w.startTime);
        m + w.slotMinutes <= toMinutes(w.endTime);
        m += w.slotMinutes
      ) {
        const at = new Date(day.getTime() + m * 60_000);
        if (at <= range.now || at < range.from || at > range.to) continue;
        const key = at.toISOString();
        if (!bookedKeys.has(key)) out.push(key);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** True when `dateTime` is exactly one of the doctor's slots (right weekday, inside hours, on a slot boundary). */
export function isOfferedSlot(
  windows: WeeklyWindow[],
  dateTime: string | Date,
): boolean {
  const at = new Date(dateTime);
  if (Number.isNaN(at.getTime())) return false;
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return windows.some(
    (w) =>
      isValidWindow(w) &&
      w.weekday === at.getUTCDay() &&
      at.getUTCSeconds() === 0 &&
      minutes >= toMinutes(w.startTime) &&
      minutes + w.slotMinutes <= toMinutes(w.endTime) &&
      (minutes - toMinutes(w.startTime)) % w.slotMinutes === 0,
  );
}
