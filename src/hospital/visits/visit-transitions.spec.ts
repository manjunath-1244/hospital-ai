import {
  TRANSITIONS,
  findTransition,
  manualTransitionsFor,
  transitionError,
} from './visit-transitions';
import {
  ACTIVE_STATUSES,
  FINAL_STATUSES,
  VISIT_STATUSES,
  isActiveStatus,
  isFinalStatus,
  isWaitingStatus,
} from './visit-status';

describe('visit status vocabulary', () => {
  it('every status is either active or final, never both', () => {
    for (const s of VISIT_STATUSES)
      expect(isActiveStatus(s) !== isFinalStatus(s)).toBe(true);
    expect([...ACTIVE_STATUSES, ...FINAL_STATUSES].sort()).toEqual(
      [...VISIT_STATUSES].sort(),
    );
  });
  it('waiting room = before the doctor', () => {
    expect(isWaitingStatus('WAITING_TRIAGE')).toBe(true);
    expect(isWaitingStatus('TRIAGED')).toBe(true);
    expect(isWaitingStatus('IN_CONSULTATION')).toBe(false);
  });
});

describe('visit transition table', () => {
  it('has no duplicate (from, to) rules and no self-transitions', () => {
    const keys = TRANSITIONS.map((t) => `${t.from}>${t.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(TRANSITIONS.every((t) => t.from !== t.to)).toBe(true);
  });
  it('final states are dead ends except the explicit reopen', () => {
    const outOfFinal = TRANSITIONS.filter((t) =>
      FINAL_STATUSES.includes(t.from),
    );
    expect(outOfFinal.map((t) => `${t.from}>${t.to}`)).toEqual([
      'COMPLETED>IN_CONSULTATION',
    ]);
    expect(outOfFinal[0].noteRequired).toBe(true);
  });
  it('every active status can still reach an end', () => {
    const reach = (from: string, seen = new Set<string>()): Set<string> => {
      if (seen.has(from)) return seen;
      seen.add(from);
      TRANSITIONS.filter((t) => t.from === from).forEach((t) =>
        reach(t.to, seen),
      );
      return seen;
    };
    for (const s of ACTIVE_STATUSES)
      expect(
        [...reach(s)].some((x) => FINAL_STATUSES.includes(x as never)),
      ).toBe(true);
  });

  it('allows the normal path with the right roles', () => {
    expect(transitionError('WAITING_TRIAGE', 'TRIAGED', 'NURSE')).toBeNull();
    expect(transitionError('TRIAGED', 'IN_CONSULTATION', 'DOCTOR')).toBeNull();
    expect(
      transitionError('IN_CONSULTATION', 'COMPLETED', 'DOCTOR'),
    ).toBeNull();
  });
  it('refuses wrong roles and impossible jumps', () => {
    expect(
      transitionError('TRIAGED', 'IN_CONSULTATION', 'RECEPTIONIST'),
    ).toMatch(/may not/);
    expect(transitionError('WAITING_TRIAGE', 'COMPLETED', 'ADMIN')).toMatch(
      /cannot go/,
    );
    expect(transitionError('COMPLETED', 'WAITING_TRIAGE', 'ADMIN')).toMatch(
      /cannot go/,
    );
    expect(transitionError('IN_CONSULTATION', 'TREATMENT', 'NURSE')).toMatch(
      /may not/,
    );
  });
  it('requires a reason where the table says so', () => {
    expect(
      transitionError('WAITING_TRIAGE', 'CANCELLED', 'RECEPTIONIST'),
    ).toMatch(/reason is required/);
    expect(
      transitionError(
        'WAITING_TRIAGE',
        'CANCELLED',
        'RECEPTIONIST',
        'patient went home',
      ),
    ).toBeNull();
    expect(transitionError('COMPLETED', 'IN_CONSULTATION', 'DOCTOR')).toMatch(
      /reason is required/,
    );
  });
  it('offers only manual buttons for a role (automatic steps are not buttons)', () => {
    const doctorFromTriaged = manualTransitionsFor('TRIAGED', 'DOCTOR').map(
      (t) => t.to,
    );
    expect(doctorFromTriaged).not.toContain('IN_CONSULTATION'); // automatic on first consultation
    expect(
      manualTransitionsFor('IN_CONSULTATION', 'DOCTOR')
        .map((t) => t.to)
        .sort(),
    ).toEqual(['COMPLETED', 'FOLLOW_UP', 'TREATMENT', 'UNDER_REVIEW']);
    expect(manualTransitionsFor('IN_CONSULTATION', 'NURSE')).toEqual([]);
  });
  it('findTransition reports auto flag', () => {
    expect(findTransition('WAITING_TRIAGE', 'TRIAGED')?.auto).toBe(true);
  });
});
