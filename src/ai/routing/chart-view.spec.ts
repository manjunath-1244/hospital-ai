import {
  detectSections,
  isPureLookup,
  renderChart,
  wantsFullDetails,
} from './chart-view';

const chart = {
  patient: {
    id: 'P9',
    name: 'Some Body',
    age: 24,
    gender: 'male',
    bloodType: 'O+',
    registeredAt: '2026-10-07T11:21:23Z',
  },
  currentVisit: {
    statusLabel: 'With the doctor',
    chiefComplaint: 'chest pain',
    priority: 2,
    primaryDoctorName: 'Dr. Test',
  },
  visitHistory: [],
  conditions: ['Need to take bed in hospital'],
  allergies: [],
  currentMedications: ['Paracetamol 500mg'],
  labs: [
    {
      test: 'HbA1c',
      value: '7.8',
      unit: '%',
      referenceRange: '4-5.6',
      status: 'ABNORMAL',
      date: '2026-10-07',
    },
  ],
  recentVitals: [],
  recentConsultations: [
    {
      at: '2026-10-07T11:31:20Z',
      doctor: 'Dr. Sarah Jenkins',
      diagnosis: 'Need to take bed in hospital',
      prescriptions: ['Paracetamol 500mg', 'Pantoprazole 40mg'],
      notes: 'Admit for observation',
    },
  ],
  imaging: [],
  appointments: [],
};

describe('lookup detection', () => {
  it.each([
    ['what was the medications the doctor gave to him', ['medications']],
    ['what medicines gave to him by doctor', ['medications']],
    ['any allergies?', ['allergies']],
    ['show lab results', ['labs']],
    ['what is his blood pressure', ['vitals']],
  ] as const)('%s', (msg, expected) => {
    expect(detectSections(msg)).toEqual(
      expect.arrayContaining(expected as any),
    );
    expect(isPureLookup(msg)).toBe(true);
  });
  it('treats "total details" as a full-chart request', () => {
    expect(
      wantsFullDetails(
        'i need total details about somisetty, what is his condition',
      ),
    ).toBe(true);
    expect(
      isPureLookup(
        'i need total details about somisetty, what is his condition',
      ),
    ).toBe(true);
  });
  it('sends reasoning questions to the model', () => {
    expect(isPureLookup('is it safe to give him ibuprofen?')).toBe(false);
    expect(isPureLookup('anything unusual about his labs?')).toBe(false);
    expect(isPureLookup('why was he admitted?')).toBe(false);
  });
});

describe('renderChart', () => {
  it('renders everything for a full-details request, including prescriptions and notes', () => {
    const t = renderChart(chart, 'all');
    expect(t).toContain('Some Body (P9) — 24 y, male');
    expect(t).toContain('Need to take bed in hospital');
    expect(t).toContain('Pantoprazole 40mg');
    expect(t).toContain('Admit for observation');
    expect(t).toContain('HbA1c');
  });
  it('renders only the requested section', () => {
    const t = renderChart(chart, ['medications']);
    expect(t).toContain('Current medications: Paracetamol 500mg');
    expect(t).toContain('Prescribed by the doctor');
    expect(t).not.toContain('HbA1c');
  });
  it('says so when the role cannot see a section instead of pretending it is empty', () => {
    const t = renderChart({ patient: chart.patient }, ['labs']);
    expect(t).toContain('not available for your role');
  });
});
