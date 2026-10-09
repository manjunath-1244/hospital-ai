/**
 * Ground truth for the seeded data the scenarios rely on (read from the seed data and the dev database on 2026-10-09;
 * see docs/MEDICAL_AI_TESTING_AND_PROJECT_GUIDE.md "Test data"). If the seed changes, update this file, not the checks.
 */
import type { Section } from './roles';

export interface PatientFacts {
  id: string;
  name: string;
  /** Strings that must appear when the section is shown (empty array = the section is empty: answer says "none"). */
  facts: Record<Section, string[]>;
  /** Short plain-words description of the section content, used as the semantic reference. */
  summary: Record<Section, string>;
  visitReason: string;
}

export const PATIENTS: PatientFacts[] = [
  {
    id: 'P1001',
    name: 'Eleanor Vance',
    facts: {
      conditions: ['Hypertension', 'Type 2 Diabetes', 'Sinusitis'],
      allergies: ['Penicillin', 'Sulfa'],
      medications: ['Lisinopril', 'Metformin', 'Amoxicillin'],
      labs: ['Creatinine', 'HbA1c'],
      vitals: [],
      imaging: [],
      appointments: [],
    },
    summary: {
      conditions: 'Eleanor Vance has hypertension, type 2 diabetes and sinusitis.',
      allergies: 'Eleanor Vance is allergic to penicillin and sulfa drugs.',
      medications: 'Eleanor Vance takes lisinopril, metformin and amoxicillin.',
      labs: 'Eleanor Vance has an abnormal creatinine and an abnormal HbA1c result.',
      vitals: 'No vitals are recorded for Eleanor Vance.',
      imaging: 'No imaging is recorded for Eleanor Vance.',
      appointments: 'Eleanor Vance has no appointments.',
    },
    visitReason: 'Diabetes follow-up',
  },
  {
    id: 'P1002',
    name: 'Marcus Brody',
    facts: {
      conditions: ['Hyperlipidemia', 'Coronary Artery Disease'],
      allergies: ['Aspirin'],
      medications: ['Atorvastatin', 'Amlodipine'],
      labs: [],
      vitals: ['NEWS2'],
      imaging: [],
      appointments: [],
    },
    summary: {
      conditions: 'Marcus Brody has hyperlipidemia and coronary artery disease.',
      allergies: 'Marcus Brody is allergic to aspirin.',
      medications: 'Marcus Brody takes atorvastatin and amlodipine.',
      labs: 'No lab results are recorded for Marcus Brody.',
      vitals: 'Marcus Brody latest vitals show a high NEWS2 score of 14 with a fast heart rate and low oxygen saturation.',
      imaging: 'No imaging is recorded for Marcus Brody.',
      appointments: 'Marcus Brody has no appointments.',
    },
    visitReason: 'Chest tightness on exertion',
  },
  {
    id: 'P1003',
    name: 'Sophia Martinez',
    facts: {
      conditions: ['Asthma'],
      allergies: [],
      medications: ['Albuterol'],
      labs: [],
      vitals: [],
      imaging: [],
      appointments: [],
    },
    summary: {
      conditions: 'Sophia Martinez has mild asthma.',
      allergies: 'Sophia Martinez has no recorded allergies.',
      medications: 'Sophia Martinez uses an albuterol inhaler.',
      labs: 'No lab results are recorded for Sophia Martinez.',
      vitals: 'No vitals are recorded for Sophia Martinez.',
      imaging: 'No imaging is recorded for Sophia Martinez.',
      appointments: 'Sophia Martinez has no appointments.',
    },
    visitReason: 'Wheezing',
  },
];

/** Policy questions (paraphrased, not copied from the documents) with the document that answers each. */
export const POLICY: Array<{ q: string; file: string; fact: string }> = [
  { q: 'how many hours must vitals be stable before a patient can be discharged', file: 'discharge-policy.md', fact: 'Vitals must be stable for 12 consecutive hours before discharge.' },
  { q: 'what glucose level triggers a critical red alert', file: 'emergency-escalation.md', fact: 'A glucose level above 250 raises a critical red alert.' },
  { q: 'what do we do if a patient gets a rash after a drug', file: 'medication-administration-guidelines.md', fact: 'Suspend the drug and treat it as an adverse drug reaction, which must be logged.' },
  { q: 'how far in advance must routine follow up visits be booked', file: 'appointment-policy.md', fact: 'Routine follow-ups must be scheduled at least 48 hours in advance.' },
  { q: 'double check requirement for insulin and heparin', file: 'medication-administration-guidelines.md', fact: 'Insulin and heparin need an independent double-check by two nurses.' },
  { q: 'which antibiotics can be used if the patient is allergic to penicillin', file: 'discharge-policy.md', fact: 'Use non-beta-lactam antibiotics for a penicillin allergy.' },
  { q: 'who must sign off before an emergency patient is released', file: 'emergency-escalation.md', fact: 'The attending physician must sign off before an emergency patient is released.' },
  { q: 'urgent consultation request who handles it', file: 'appointment-policy.md', fact: 'Urgent consultation requests are routed to the Triage Nurse.' },
  { q: 'who needs to clear a cancellation made the day before the visit', file: 'appointment-policy.md', fact: 'A late cancellation needs supervisory approval.' },
  { q: 'how long can an emergent level 2 patient wait for a physician', file: 'emergency-triage-protocol.md', fact: 'A level 2 emergent patient must be seen within 10 minutes.' },
  { q: 'signs of a stroke that should trigger a neurology referral', file: 'neurology-referral-guidelines.md', fact: 'Facial droop, arm weakness and speech difficulty trigger a neurology referral.' },
  { q: 'can one nurse alone give insulin', file: 'medication-administration-guidelines.md', fact: 'No, insulin needs a second nurse for the double-check.' },
  { q: 'what happens to the antibiotic choice at discharge when the patient has a beta-lactam allergy', file: 'discharge-and-followup-policy.md', fact: 'A beta-lactam allergy changes the antibiotic choice at discharge.' },
  { q: 'what does the attending physician have to sign before discharge', file: 'discharge-policy.md', fact: 'The attending physician must sign the electronic discharge summary.' },
  { q: 'within how many hours must an adverse drug reaction be logged', file: 'medication-administration-guidelines.md', fact: 'An adverse drug reaction must be logged within 4 hours.' },
  { q: 'what is the rule for cancelling an appointment with 12 hours notice', file: 'appointment-policy.md', fact: 'A cancellation with short notice needs supervisory approval.' },
];

export const SPECIALISTS = { cardiology: 'Wilson', neurology: 'Chen' };

/** Swap two letters inside the first name: a realistic typo ("Eleanor" -> "Elaenor"). */
export function typo(name: string): string {
  const [first, ...rest] = name.split(' ');
  if (first.length < 5) return name;
  const c = first.split('');
  [c[2], c[3]] = [c[3], c[2]];
  return [c.join(''), ...rest].join(' ');
}
