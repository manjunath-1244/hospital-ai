import { generateSlots, isOfferedSlot, isValidWindow } from './availability';

// 2026-10-12 is a Monday (UTC weekday 1)
const monday = (hhmm: string) => `2026-10-12T${hhmm}:00.000Z`;
const hours = [
  { weekday: 1, startTime: '09:00', endTime: '10:00', slotMinutes: 30 },
];
const range = {
  from: new Date('2026-10-12T00:00:00Z'),
  to: new Date('2026-10-12T23:59:59Z'),
  now: new Date('2026-10-11T00:00:00Z'),
};

describe('availability', () => {
  it('builds slots from the weekly window', () => {
    expect(generateSlots(hours, range, new Set())).toEqual([
      monday('09:00'),
      monday('09:30'),
    ]);
  });
  it('skips booked slots and slots in the past', () => {
    expect(generateSlots(hours, range, new Set([monday('09:00')]))).toEqual([
      monday('09:30'),
    ]);
    expect(
      generateSlots(
        hours,
        { ...range, now: new Date(monday('09:10')) },
        new Set(),
      ),
    ).toEqual([monday('09:30')]);
  });
  it('returns nothing on days without hours and honours the limit', () => {
    expect(
      generateSlots(
        hours,
        {
          ...range,
          from: new Date('2026-10-13T00:00:00Z'),
          to: new Date('2026-10-13T23:00:00Z'),
        },
        new Set(),
      ),
    ).toEqual([]);
    expect(generateSlots(hours, range, new Set(), 1)).toHaveLength(1);
  });
  it('knows which requested times are real slots', () => {
    expect(isOfferedSlot(hours, monday('09:30'))).toBe(true);
    expect(isOfferedSlot(hours, monday('09:45'))).toBe(false);
    expect(isOfferedSlot(hours, monday('10:00'))).toBe(false);
    expect(isOfferedSlot(hours, '2026-10-13T09:00:00.000Z')).toBe(false);
    expect(isOfferedSlot(hours, 'garbage')).toBe(false);
  });
  it('rejects malformed windows', () => {
    expect(
      isValidWindow({
        weekday: 9,
        startTime: '09:00',
        endTime: '10:00',
        slotMinutes: 30,
      }),
    ).toBe(false);
    expect(
      isValidWindow({
        weekday: 1,
        startTime: '10:00',
        endTime: '09:00',
        slotMinutes: 30,
      }),
    ).toBe(false);
    expect(isValidWindow(hours[0])).toBe(true);
  });
});
