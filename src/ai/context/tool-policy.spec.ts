import {
  applyToolPolicy,
  bindingViolation,
  withheldReason,
} from './tool-policy';
import { contextHash } from './agent-context';

const base = {
  user: { id: 'u1', role: 'DOCTOR' as const, specialty: null },
  patient: { id: 'P1' },
  allowedPatientIds: ['P1'],
  visit: { id: 'V1', status: 'IN_CONSULTATION', isOpen: true, priority: 2 },
  conversation: { threadId: 't', summarized: false },
  now: '2026-10-08T00:00:00Z',
};
const tools = [
  { name: 'read', roles: ['DOCTOR', 'NURSE'] as any },
  {
    name: 'write',
    roles: ['DOCTOR'] as any,
    requires: { openVisit: true, patientBound: true },
  },
  { name: 'adminOnly', roles: ['ADMIN'] as any },
];

describe('tool policy', () => {
  it('shows a role only its own tools', () => {
    expect(applyToolPolicy(base, tools).permissions.tools).toEqual([
      'read',
      'write',
    ]);
  });
  it('withholds visit-bound tools once the visit is finished, with the reason', () => {
    const done = {
      ...base,
      visit: { ...base.visit, status: 'COMPLETED', isOpen: false },
    };
    const p = applyToolPolicy(done, tools).permissions;
    expect(p.tools).toEqual(['read']);
    expect(p.withheld).toEqual([
      { tool: 'write', reason: expect.stringContaining('completed') },
    ]);
  });
  it('does not withhold when there is no visit in context (hospital-wide question)', () => {
    expect(withheldReason(tools[1], { visit: null })).toBeNull();
  });
  it('refuses a write aimed at a patient outside the context', () => {
    expect(bindingViolation(tools[1], { patientId: 'P1' }, base)).toBeNull();
    expect(bindingViolation(tools[1], { patientId: 'p1' }, base)).toBeNull();
    expect(bindingViolation(tools[1], { patientId: 'P2' }, base)).toContain(
      'P2',
    );
  });
  it('ignores tools that are not patient-bound and calls without a patient', () => {
    expect(bindingViolation(tools[0], { patientId: 'P9' }, base)).toBeNull();
    expect(bindingViolation(tools[1], {}, base)).toBeNull();
  });
  it('hashes the context without the clock', () => {
    const a = applyToolPolicy(base, tools);
    expect(contextHash(a)).toBe(contextHash({ ...a, now: 'later' }));
    expect(contextHash(a)).not.toBe(
      contextHash({ ...a, patient: { id: 'P2' } }),
    );
  });
});
