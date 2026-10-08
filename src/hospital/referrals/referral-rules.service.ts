import { Injectable } from '@nestjs/common';
import {
  EvidenceItem,
  ReferralRulesResult,
  RuleMatch,
} from './referral.types';

export interface ClinicalContextInput {
  patientId: string;
  visitId?: string | null;
  chiefComplaint?: string | null;
  vitals?: Array<{
    recordedAt?: string | Date;
    heartRate?: number | null;
    bpSystolic?: number | null;
    bpDiastolic?: number | null;
    spO2?: number | null;
    tempCelsius?: number | null;
    respiratoryRate?: number | null;
    consciousness?: string | null;
    news2Score?: number | null;
    riskLevel?: string | null;
  }>;
  labs?: Array<{
    testName: string;
    value: string;
    unit?: string;
    status?: string;
    referenceRange?: string;
  }>;
  consultations?: Array<{
    diagnosis?: string;
    notes?: string;
    prescriptions?: string[];
  }>;
  conditions?: string[];
  allergies?: string[];
  currentMedications?: string[];
}

@Injectable()
export class ReferralRulesService {
  /**
   * Deterministically evaluates clinical context for referral criteria.
   * Operates strictly on current visit clinical facts.
   * Past medical history alone will never trigger an acute referral.
   */
  evaluate(ctx: ClinicalContextInput): ReferralRulesResult {
    const matches: RuleMatch[] = [];
    const historicalOnlyCandidates: string[] = [];
    const missingInfo: string[] = [];

    const complaint = (ctx.chiefComplaint ?? '').toLowerCase();
    const latestVitals = ctx.vitals && ctx.vitals.length > 0 ? ctx.vitals[0] : null;
    const labs = ctx.labs ?? [];
    const recentNotes = (ctx.consultations ?? [])
      .map((c) => `${c.diagnosis ?? ''} ${c.notes ?? ''}`)
      .join(' ')
      .toLowerCase();

    // Check missing vitals / labs for clinical context completeness
    if (!latestVitals) {
      missingInfo.push('Current visit vitals not recorded');
    }
    if (labs.length === 0) {
      missingInfo.push('No recent lab results on file');
    }

    // --- CARDIOLOGY RULES ---

    // CARD_RULE_01: Acute Chest Pain or Angina Equivalent
    const chestPainKeywords = [
      'chest pain',
      'chest pressure',
      'substernal pain',
      'chest tightness',
      'angina',
      'radiating arm pain',
      'radiating jaw pain',
    ];
    const hasChestPain = chestPainKeywords.some(
      (kw) => complaint.includes(kw) || recentNotes.includes(kw),
    );

    if (hasChestPain) {
      const facts: EvidenceItem[] = [
        {
          field: 'Chief Complaint / Notes',
          value: ctx.chiefComplaint || 'Chest pain reported',
          source: 'Current Visit Presentation',
        },
      ];
      if (latestVitals?.news2Score !== undefined && latestVitals?.news2Score !== null) {
        facts.push({
          field: 'NEWS2 Score',
          value: String(latestVitals.news2Score),
          source: 'Current Vitals',
        });
      }
      matches.push({
        ruleId: 'CARD_RULE_01',
        specialty: 'Cardiology',
        urgency:
          (latestVitals?.news2Score ?? 0) >= 5 ? 'EMERGENCY' : 'URGENT',
        description: 'Acute chest pain or angina-equivalent symptoms',
        matchedFacts: facts,
      });
    }

    // CARD_RULE_02: Elevated Troponin
    const troponinLab = labs.find((l) => /troponin/i.test(l.testName));
    if (troponinLab) {
      const numVal = parseFloat(troponinLab.value);
      const isElevated =
        (Number.isFinite(numVal) && numVal > 0.04) ||
        /high|critical|abnormal/i.test(troponinLab.status ?? '');

      if (isElevated) {
        matches.push({
          ruleId: 'CARD_RULE_02',
          specialty: 'Cardiology',
          urgency: 'EMERGENCY',
          description: 'Elevated cardiac biomarker (Troponin)',
          matchedFacts: [
            {
              field: `Lab: ${troponinLab.testName}`,
              value: `${troponinLab.value} ${troponinLab.unit ?? ''}`.trim(),
              source: 'Lab Results',
            },
          ],
        });
      }
    }

    // CARD_RULE_03: Tachycardia + Hypotension / Hemodynamic Instability
    if (latestVitals) {
      const hr = latestVitals.heartRate ?? 0;
      const sbp = latestVitals.bpSystolic ?? 120;
      if (hr > 120 && sbp < 90) {
        matches.push({
          ruleId: 'CARD_RULE_03',
          specialty: 'Cardiology',
          urgency: 'EMERGENCY',
          description:
            'Severe tachycardia (HR > 120) with hypotension (SBP < 90)',
          matchedFacts: [
            {
              field: 'Heart Rate',
              value: `${hr} bpm`,
              source: 'Current Vitals',
            },
            {
              field: 'Systolic BP',
              value: `${sbp} mmHg`,
              source: 'Current Vitals',
            },
          ],
        });
      }
    }

    // CARD_RULE_04: ECG Abnormalities
    const ecgKeywords = ['st elevation', 'st depression', 'lbbb', 'ischemic ecg', 'vtach'];
    const hasEcgChange = ecgKeywords.some((kw) => recentNotes.includes(kw));
    if (hasEcgChange) {
      matches.push({
        ruleId: 'CARD_RULE_04',
        specialty: 'Cardiology',
        urgency: 'URGENT',
        description: 'Recorded ECG ischemic changes or malignant arrhythmia',
        matchedFacts: [
          {
            field: 'ECG Findings',
            value: 'Ischemic/Arrhythmic findings in notes',
            source: 'Clinical Notes',
          },
        ],
      });
    }

    // --- NEUROLOGY RULES ---

    // NEURO_RULE_01: Acute Focal Neurological Deficit / Stroke Symptoms
    const neuroDeficitKeywords = [
      'facial droop',
      'arm drift',
      'slurred speech',
      'aphasia',
      'dysarthria',
      'focal weakness',
      'hemiparesis',
      'focal numbness',
      'sudden weakness',
    ];
    const hasNeuroDeficit = neuroDeficitKeywords.some(
      (kw) => complaint.includes(kw) || recentNotes.includes(kw),
    );

    if (hasNeuroDeficit) {
      matches.push({
        ruleId: 'NEURO_RULE_01',
        specialty: 'Neurology',
        urgency: 'EMERGENCY',
        description: 'Acute focal neurological deficit / stroke symptoms',
        matchedFacts: [
          {
            field: 'Neurological Symptoms',
            value: ctx.chiefComplaint || 'Focal neurological deficit reported',
            source: 'Current Visit Presentation',
          },
        ],
      });
    }

    // NEURO_RULE_02: Sudden Severe / Thunderclap Headache
    const headacheKeywords = [
      'thunderclap headache',
      'sudden severe headache',
      'worst headache of life',
    ];
    const hasSevereHeadache = headacheKeywords.some(
      (kw) => complaint.includes(kw) || recentNotes.includes(kw),
    );

    if (hasSevereHeadache) {
      matches.push({
        ruleId: 'NEURO_RULE_02',
        specialty: 'Neurology',
        urgency: 'EMERGENCY',
        description: 'Sudden onset severe / thunderclap headache',
        matchedFacts: [
          {
            field: 'Chief Complaint',
            value: ctx.chiefComplaint || 'Sudden severe headache',
            source: 'Current Visit Presentation',
          },
        ],
      });
    }

    // NEURO_RULE_03: Altered Consciousness (AVPU != ALERT)
    if (latestVitals?.consciousness && latestVitals.consciousness !== 'ALERT') {
      matches.push({
        ruleId: 'NEURO_RULE_03',
        specialty: 'Neurology',
        urgency: 'EMERGENCY',
        description: 'Altered level of consciousness (AVPU score not ALERT)',
        matchedFacts: [
          {
            field: 'Consciousness (AVPU)',
            value: latestVitals.consciousness,
            source: 'Current Vitals',
          },
        ],
      });
    }

    // NEURO_RULE_04: Hypertensive Crisis with Neurological Symptoms
    if (latestVitals) {
      const sbp = latestVitals.bpSystolic ?? 0;
      const dbp = latestVitals.bpDiastolic ?? 0;
      const isHypertensiveCrisis = sbp > 180 || dbp > 120;
      const hasHeadacheOrConfusion =
        complaint.includes('headache') ||
        complaint.includes('vision') ||
        complaint.includes('confused') ||
        recentNotes.includes('headache');

      if (isHypertensiveCrisis && hasHeadacheOrConfusion) {
        matches.push({
          ruleId: 'NEURO_RULE_04',
          specialty: 'Neurology',
          urgency: 'URGENT',
          description:
            'Hypertensive crisis (BP > 180/120) with neurological complaints',
          matchedFacts: [
            {
              field: 'Blood Pressure',
              value: `${sbp}/${dbp} mmHg`,
              source: 'Current Vitals',
            },
            {
              field: 'Symptoms',
              value: ctx.chiefComplaint || 'Neurological complaints',
              source: 'Current Visit Presentation',
            },
          ],
        });
      }
    }

    // --- HISTORICAL ONLY CHECK ---
    const historicalConditions = ctx.conditions ?? [];
    for (const cond of historicalConditions) {
      const lcond = cond.toLowerCase();
      if (/cardiac|coronary|hypertension|stent|mi|heart/i.test(lcond)) {
        if (!matches.some((m) => m.specialty === 'Cardiology')) {
          historicalOnlyCandidates.push(`Past cardiac history: ${cond}`);
        }
      }
      if (/stroke|tia|migraine|seizure|headache/i.test(lcond)) {
        if (!matches.some((m) => m.specialty === 'Neurology')) {
          historicalOnlyCandidates.push(`Past neurological history: ${cond}`);
        }
      }
    }

    return {
      triggered: matches.length > 0,
      matches,
      historicalOnlyCandidates,
      missingInfo,
    };
  }
}
