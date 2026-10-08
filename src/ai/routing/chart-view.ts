/**
 * Deterministic views of a patient chart for factual lookups ("what medications did the doctor give him?").
 * Exact, complete and instant: the language model is not involved, so it cannot omit or invent anything.
 */
export type Section =
  | 'conditions'
  | 'allergies'
  | 'medications'
  | 'labs'
  | 'vitals'
  | 'consultations'
  | 'imaging'
  | 'appointments';

const SECTION_WORDS: Array<[Section, RegExp]> = [
  [
    'medications',
    /\b(medic\w*|prescri\w*|drugs?|tablets?|pills?|dose|dosage|given|gave)\b/i,
  ],
  ['allergies', /\ballerg\w*\b/i],
  [
    'labs',
    /\b(labs?|lab results?|test results?|blood tests?|hba1c|creatinine|glucose|cholesterol)\b/i,
  ],
  [
    'vitals',
    /\b(vitals?|blood pressure|bp|heart rate|pulse|spo2|oxygen|temperature|news2|respiratory)\b/i,
  ],
  [
    'conditions',
    /\b(conditions?|diagnos\w*|diseases?|illness|problems?|history)\b/i,
  ],
  [
    'consultations',
    /\b(consult\w*|doctor said|doctor gave|doctor's|notes?|visit|treatment|treated)\b/i,
  ],
  ['imaging', /\b(imaging|scans?|x-?rays?|mri|ct|ultrasound|radiolog\w*)\b/i],
  ['appointments', /\b(appointments?|follow-?ups?|scheduled|booked)\b/i],
];

const ALL_DETAILS =
  /\b(details?|everything|full|complete|total|entire|all (the )?(info|information|data)|chart|record|profile|overview|summar(y|ise|ize))\b/i;
// Words that mean the user wants reasoning, comparison or advice, not a lookup: those go to the model.
const REASONING =
  /\b(why|should|shall|safe|safely|concern\w*|risk\w*|compare|recommend\w*|interaction\w*|explain|unusual|abnormal|worr\w*|better|worse|trend\w*|likely|could|would|can (we|i|he|she)|is it|are they|suggest\w*|advice|next step|what if|prognosis)\b/i;
// Pronouns / phrases that point back at the patient the conversation is about.
export const REFERS_BACK =
  /\b(he|him|his|she|her|hers|they|them|their|the patient|that patient|this patient|same patient|patient's)\b/i;

export function detectSections(message: string): Section[] {
  return SECTION_WORDS.filter(([, rx]) => rx.test(message)).map(([s]) => s);
}

export function wantsFullDetails(message: string): boolean {
  return ALL_DETAILS.test(message);
}

/** A factual lookup about one patient: names a section (or asks for everything) and asks for no reasoning. */
export function isPureLookup(message: string): boolean {
  if (REASONING.test(message)) return false;
  return detectSections(message).length > 0 || wantsFullDetails(message);
}

const fmtDate = (d: unknown) => {
  if (!d) return 'n/a';
  const dt = new Date(d as string);
  return Number.isNaN(dt.getTime())
    ? String(d)
    : dt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};
const list = (a: unknown) =>
  Array.isArray(a) && a.length ? a.join(', ') : 'none recorded';

/** Renders the requested sections (or everything) of a getPatientSummary result as plain text. */
export function renderChart(chart: any, sections: Section[] | 'all'): string {
  const p = chart.patient ?? {};
  const want = (s: Section) => sections === 'all' || sections.includes(s);
  const out: string[] = [];

  out.push(
    `${p.name} (${p.id}) — ${p.age} y, ${p.gender}${p.bloodType ? `, blood type ${p.bloodType}` : ''}`,
  );
  if (sections === 'all') {
    const v = chart.currentVisit;
    out.push(
      v
        ? `Current visit: ${v.statusLabel}${v.chiefComplaint ? ` | Reason: ${v.chiefComplaint}` : ''}${v.priority ? ` | Triage priority ${v.priority}` : ''}${v.primaryDoctorName ? ` | Doctor: ${v.primaryDoctorName}` : ''}`
        : 'No visit on record.',
    );
    out.push(`Registered: ${fmtDate(p.registeredAt)}`);
    const history = (chart.visitHistory ?? []).slice(1);
    if (history.length)
      out.push(
        `Earlier visits: ${history.map((h: any) => `${fmtDate(h.arrivedAt)} ${h.statusLabel}${h.chiefComplaint ? ` (${h.chiefComplaint})` : ''}`).join('; ')}`,
      );
  }

  const missing = (key: string, label: string) => {
    if (!(key in chart)) out.push(`${label}: not available for your role.`);
    return !(key in chart);
  };

  if (want('conditions') && !missing('conditions', 'Conditions / diagnoses'))
    out.push(`Conditions / diagnoses: ${list(chart.conditions)}`);
  if (want('allergies') && !missing('allergies', 'Allergies'))
    out.push(`Allergies: ${list(chart.allergies)}`);

  if (want('medications') && !missing('currentMedications', 'Medications')) {
    out.push(`Current medications: ${list(chart.currentMedications)}`);
    const cons = (chart.recentConsultations ?? []) as any[];
    const given = cons.filter((c) => c.prescriptions?.length);
    if (given.length) {
      out.push('Prescribed by the doctor:');
      for (const c of given)
        out.push(
          `  • ${fmtDate(c.at)}, ${c.doctor}: ${c.prescriptions.join('; ')} (for: ${c.diagnosis})`,
        );
    } else if (sections !== 'all') {
      out.push('No prescriptions recorded in the consultations on file.');
    }
  }
  if (
    Array.isArray(chart.medicationSafetyAlerts) &&
    chart.medicationSafetyAlerts.length &&
    (want('medications') || want('allergies') || sections === 'all')
  ) {
    out.push('⚠ Medication safety alerts:');
    for (const a of chart.medicationSafetyAlerts)
      out.push(`  • [${a.severity}] ${a.drug}: ${a.message}`);
  }

  if (
    want('consultations') &&
    !missing('recentConsultations', 'Consultations')
  ) {
    const cons = chart.recentConsultations as any[];
    if (!cons.length) out.push('Consultations: none recorded.');
    else {
      out.push('Consultations (most recent first):');
      for (const c of cons) {
        out.push(
          `  • ${fmtDate(c.at)}, ${c.doctor} — Diagnosis: ${c.diagnosis}${c.prescriptions?.length ? `; Prescribed: ${c.prescriptions.join('; ')}` : ''}${c.notes ? `; Notes: ${c.notes}` : ''}`,
        );
      }
    }
  }
  if (want('labs') && !missing('labs', 'Lab results')) {
    const labs = chart.labs as any[];
    if (!labs.length) out.push('Lab results: none recorded.');
    else {
      out.push('Lab results:');
      for (const l of labs)
        out.push(
          `  • ${l.test}: ${l.value} ${l.unit} (ref ${l.referenceRange}) — ${l.status}, ${l.date}`,
        );
    }
  }
  if (want('vitals') && !missing('recentVitals', 'Vitals')) {
    const v = chart.recentVitals as any[];
    if (!v.length) out.push('Vitals: none recorded.');
    else {
      out.push('Recent vitals:');
      for (const x of v) {
        out.push(
          `  • ${fmtDate(x.at)}: HR ${x.heartRate}, BP ${x.bpSystolic}, SpO2 ${x.spO2}%, temp ${x.tempC}°C, RR ${x.respiratoryRate}, ${x.consciousness} — NEWS2 ${x.news2} (${x.risk})`,
        );
      }
    }
  }
  if (want('imaging') && !missing('imaging', 'Imaging')) {
    const im = chart.imaging as any[];
    if (!im.length) out.push('Imaging: none recorded.');
    else {
      out.push('Imaging:');
      for (const s of im)
        out.push(
          `  • ${s.modality}${s.description ? ` — ${s.description}` : ''}${s.studyDate ? ` (${s.studyDate})` : ''}${s.impression ? `. Impression: ${s.impression}` : '. No impression reported yet.'}`,
        );
    }
  }
  if (want('appointments') && !missing('appointments', 'Appointments')) {
    const ap = chart.appointments as any[];
    if (!ap.length) out.push('Appointments: none.');
    else {
      out.push('Appointments:');
      for (const a of ap)
        out.push(
          `  • ${a.when} — ${a.doctor} (${a.department}), ${a.status}: ${a.reason}`,
        );
    }
  }
  return out.join('\n');
}
