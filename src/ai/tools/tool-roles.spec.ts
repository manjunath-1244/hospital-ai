jest.mock('@nestjs/typeorm', () => ({ InjectRepository: () => () => {} }));

import { ClinicalToolsFactory } from './clinical-tools.factory';
import { USER_ROLES, type UserRole } from '../../security/roles.decorator';

/**
 * Which agent tools each role may use. Written as the specification (who SHOULD be able to do what); the factory's
 * definitions are then checked against it. Dependencies are stubs: tool definitions only capture them.
 */
const stub = () => ({}) as any;
const factory = new ClinicalToolsFactory(
  ...(Array.from({ length: 17 }, stub) as any[] as any),
);
const toolsOf = (role: UserRole) =>
  factory.toolNamesFor({ userId: 'u', userName: 'u', role });

/** tool -> the only roles that may have it */
const ONLY: Record<string, UserRole[]> = {
  proposeRegistration: ['RECEPTIONIST', 'ADMIN'],
  proposeConsultation: ['DOCTOR', 'ADMIN'],
  proposeReferral: ['DOCTOR', 'NURSE', 'ADMIN'],
  proposeLabOrder: ['DOCTOR', 'NURSE', 'ADMIN'],
  reviewReferralNeed: ['DOCTOR', 'NURSE', 'ADMIN'],
  proposeAppointment: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'],
  // chart reads follow the same minimum-necessary rule as the patient summary endpoint
  getVitalsHistory: ['DOCTOR', 'NURSE', 'ADMIN', 'SPECIALIST'],
  getLabs: [
    'DOCTOR',
    'NURSE',
    'ADMIN',
    'PHARMACIST',
    'RADIOLOGIST',
    'SPECIALIST',
  ],
  getMedications: [
    'DOCTOR',
    'NURSE',
    'ADMIN',
    'PHARMACIST',
    'CARE_COORDINATOR',
    'SPECIALIST',
  ],
  getAllergies: [
    'DOCTOR',
    'NURSE',
    'ADMIN',
    'PHARMACIST',
    'RADIOLOGIST',
    'SPECIALIST',
  ],
  searchPatients: [
    'DOCTOR',
    'NURSE',
    'RECEPTIONIST',
    'ADMIN',
    'PHARMACIST',
    'RADIOLOGIST',
    'CARE_COORDINATOR',
  ],
  getPatientSummary: [...USER_ROLES],
  getCurrentVisit: [...USER_ROLES],
};

describe('agent tools per role', () => {
  it.each(Object.entries(ONLY))(
    '%s is available to exactly %j',
    (tool, roles) => {
      for (const role of USER_ROLES)
        expect([role, toolsOf(role).includes(tool)]).toEqual([
          role,
          roles.includes(role),
        ]);
    },
  );

  it('a specialist cannot list or search patients or run hospital-wide queries', () => {
    const t = toolsOf('SPECIALIST');
    for (const forbidden of [
      'searchPatients',
      'getHospitalOverview',
      'searchClinicalRecords',
      'proposeRegistration',
      'proposeConsultation',
      'proposeAppointment',
      'proposeReferral',
    ])
      expect(t).not.toContain(forbidden);
  });

  it('a receptionist gets no clinical tools', () => {
    const t = toolsOf('RECEPTIONIST');
    for (const forbidden of [
      'searchClinicalRecords',
      'verifyMedicationSafety',
      'getLabs',
      'getVitalsHistory',
      'getMedications',
      'getAllergies',
      'proposeConsultation',
      'proposeReferral',
      'proposeLabOrder',
    ])
      expect(t).not.toContain(forbidden);
  });

  it('pharmacist, radiologist and care coordinator cannot propose clinical actions', () => {
    for (const role of [
      'PHARMACIST',
      'RADIOLOGIST',
      'CARE_COORDINATOR',
    ] as UserRole[])
      for (const tool of [
        'proposeReferral',
        'proposeLabOrder',
        'proposeConsultation',
      ])
        expect(toolsOf(role)).not.toContain(tool);
  });

  it('a specialist can read the chart of a referred patient and the guidelines', () => {
    const t = toolsOf('SPECIALIST');
    for (const needed of [
      'getPatientSummary',
      'getLabs',
      'getVitalsHistory',
      'getMedications',
      'getAllergies',
      'getCurrentVisit',
      'searchClinicalGuidelines',
      'searchHospitalPolicies',
    ])
      expect(t).toContain(needed);
  });

  it('every role has at least one tool and no tool name is duplicated', () => {
    for (const role of USER_ROLES) {
      const t = toolsOf(role);
      expect(t.length).toBeGreaterThan(0);
      expect(new Set(t).size).toBe(t.length);
    }
  });
});

describe('staff and specialist lookup is open to every signed-in role (names carry no patient data)', () => {
  it.each(['getStaffSummary', 'findSpecialists', 'getSpecialistAvailability'])(
    '%s',
    (tool) => {
      for (const role of USER_ROLES)
        expect([role, toolsOf(role).includes(tool)]).toEqual([role, true]);
    },
  );
});
