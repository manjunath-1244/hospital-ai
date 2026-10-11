import { Injectable } from '@nestjs/common';
import { SafetyFinding, SafetyReport } from './hospital.types';

export interface SafetyPatient {
  age: number;
  gender: string;
  allergies: string[];
  currentMedications: string[];
}

const CLASSES: Record<string, string[]> = {
  penicillin: [
    'penicillin',
    'amoxicillin',
    'ampicillin',
    'piperacillin',
    'flucloxacillin',
    'amoxicillin-clavulanate',
    'co-amoxiclav',
    'augmentin',
  ],
  cephalosporin: [
    'cefalexin',
    'cephalexin',
    'cefazolin',
    'cefuroxime',
    'ceftriaxone',
    'cefixime',
    'cefepime',
  ],
  sulfonamide: [
    'sulfamethoxazole',
    'trimethoprim-sulfamethoxazole',
    'co-trimoxazole',
    'bactrim',
    'sulfadiazine',
  ],
  nsaid: [
    'aspirin',
    'ibuprofen',
    'naproxen',
    'diclofenac',
    'ketorolac',
    'indomethacin',
    'celecoxib',
    'meloxicam',
  ],
};
const ACE_INHIBITORS = [
  'lisinopril',
  'enalapril',
  'ramipril',
  'captopril',
  'perindopril',
];
const INTERACTIONS: Array<{
  a: string[];
  b: string[];
  severity: 'WARNING' | 'CRITICAL';
  message: string;
}> = [
  {
    a: ['warfarin'],
    b: [...CLASSES.nsaid, 'clopidogrel'],
    severity: 'CRITICAL',
    message: 'Warfarin with NSAID/antiplatelet markedly raises bleeding risk.',
  },
  {
    a: ACE_INHIBITORS,
    b: ['spironolactone', 'potassium chloride', 'eplerenone'],
    severity: 'WARNING',
    message:
      'ACE inhibitor with potassium-raising agent: risk of hyperkalaemia; monitor K+.',
  },
  {
    a: ['simvastatin'],
    b: ['clarithromycin', 'erythromycin'],
    severity: 'CRITICAL',
    message: 'Macrolide inhibits CYP3A4: rhabdomyolysis risk with simvastatin.',
  },
  {
    a: ['sildenafil', 'tadalafil'],
    b: ['nitroglycerin', 'isosorbide'],
    severity: 'CRITICAL',
    message: 'PDE5 inhibitor with nitrate: severe hypotension.',
  },
  {
    a: ['sertraline', 'fluoxetine', 'paroxetine', 'citalopram', 'escitalopram'],
    b: ['tramadol'],
    severity: 'WARNING',
    message: 'SSRI with tramadol: serotonin syndrome and seizure risk.',
  },
  {
    a: ['metformin'],
    b: ['contrast'],
    severity: 'WARNING',
    message: 'Hold metformin around iodinated contrast.',
  },
];

/**
 * ============================================================================
 * 💊 CONCEPT: Pharmacological Decision Support & Medication Safety Gate
 * ============================================================================
 * WHAT IT IS:
 * Deterministic pharmacological screening engine that audits medical prescriptions
 * and consultation orders before proposal generation or physician signing.
 *
 * HOW IMPLEMENTED:
 * - Direct & Class Allergy Screening:
 *   Normalizes drug names and cross-references patient allergy history against drug classes
 *   (e.g., penicillin, cephalosporin, sulfonamide, NSAID) with cross-reactivity warnings.
 * - Drug-Drug Interactions (DDI):
 *   Detects dangerous clinical combinations (e.g., Warfarin + NSAID bleeding risk,
 *   PDE5 inhibitors + Nitrates severe hypotension, Simvastatin + Macrolide rhabdomyolysis).
 * - Renal Dose Adjustments (CKD-EPI 2021 eGFR):
 *   Calculates estimated Glomerular Filtration Rate from serum creatinine; flags renal
 *   contraindications (e.g., Metformin contraindicated if eGFR < 30).
 * - Safety Status Enforcement:
 *   Returns `CRITICAL_BLOCK`, `WARNING`, or `SAFE`.
 *
 * USE CASE:
 * Prevents adverse drug events (ADEs), fatal drug-drug interactions, and contraindicated
 * prescribing in hospitalized and ambulatory patients.
 * ============================================================================
 * Deterministic prescription screening against allergies, current meds, interactions and renal function.
 */
@Injectable()
export class MedicationSafetyService {
  /** "Amoxicillin 500mg TID" -> "amoxicillin" */
  normalizeDrug(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .split(/\s+\d|\s+(?:tab|cap|po|iv|im|bid|tid|qid|daily)\b/)[0]
      .trim();
  }

  /** CKD-EPI 2021. `creatinineMgDl` in mg/dL. */
  egfr(creatinineMgDl: number, age: number, gender: string): number {
    const female = gender.toLowerCase().startsWith('f');
    const k = female ? 0.7 : 0.9;
    const a = female ? -0.241 : -0.302;
    const ratio = creatinineMgDl / k;
    return (
      142 *
      Math.min(ratio, 1) ** a *
      Math.max(ratio, 1) ** -1.2 *
      0.9938 ** age *
      (female ? 1.012 : 1)
    );
  }

  /** Converts a creatinine lab to mg/dL; returns undefined if the unit is not recognised. */
  creatinineToMgDl(value: number, unit: string): number | undefined {
    const u = unit.toLowerCase().replace(/\s/g, '');
    if (u === 'mg/dl') return value;
    if (u === 'µmol/l' || u === 'umol/l') return value / 88.4;
    return undefined;
  }

  audit(
    patient: SafetyPatient,
    medications: string[],
    creatinineMgDl?: number,
  ): SafetyReport {
    const findings: SafetyFinding[] = [];
    const drugs = medications
      .map((m) => ({ raw: m, name: this.normalizeDrug(m) }))
      .filter((d) => d.name);
    const current = patient.currentMedications.map((m) =>
      this.normalizeDrug(m),
    );
    const allergies = patient.allergies
      .map((a) => a.toLowerCase())
      .filter((a) => a && !/^(none|nkda|no known)/.test(a));

    for (const d of drugs) {
      // Allergies (direct and class)
      for (const allergy of allergies) {
        const classKey = Object.keys(CLASSES).find(
          (k) =>
            allergy.includes(k) ||
            (k === 'sulfonamide' && allergy.includes('sulfa')) ||
            (k === 'nsaid' && allergy.includes('aspirin')),
        );
        if (d.name.includes(allergy) || allergy.includes(d.name)) {
          findings.push({
            severity: 'CRITICAL',
            type: 'ALLERGY',
            drug: d.raw,
            message: `Documented allergy to "${allergy}".`,
          });
        } else if (
          classKey &&
          CLASSES[classKey].some((x) => d.name.includes(x))
        ) {
          findings.push({
            severity: 'CRITICAL',
            type: 'ALLERGY',
            drug: d.raw,
            message: `Belongs to the ${classKey} class; patient allergic to "${allergy}".`,
          });
        } else if (
          classKey === 'penicillin' &&
          CLASSES.cephalosporin.some((x) => d.name.includes(x))
        ) {
          findings.push({
            severity: 'WARNING',
            type: 'CROSS_REACTIVITY',
            drug: d.raw,
            message:
              'Cephalosporin in a penicillin-allergic patient: possible cross-reactivity (~2%). Confirm reaction history.',
          });
        }
      }

      // Duplicate therapy
      if (
        current.includes(d.name) ||
        drugs.filter((o) => o.name === d.name).length > 1
      ) {
        findings.push({
          severity: 'WARNING',
          type: 'DUPLICATE_THERAPY',
          drug: d.raw,
          message:
            'Already on this drug (current medications or duplicated in this order).',
        });
      }

      // Renal
      const renalSensitive =
        d.name.includes('metformin') ||
        CLASSES.nsaid.some((x) => d.name.includes(x)) ||
        d.name.includes('enoxaparin');
      if (renalSensitive) {
        if (creatinineMgDl === undefined) {
          findings.push({
            severity: 'INFO',
            type: 'RENAL',
            drug: d.raw,
            message:
              'Renally cleared drug but no recent creatinine on file; check renal function.',
          });
        } else {
          const egfr = Math.round(
            this.egfr(creatinineMgDl, patient.age, patient.gender),
          );
          if (d.name.includes('metformin')) {
            if (egfr < 30)
              findings.push({
                severity: 'CRITICAL',
                type: 'RENAL',
                drug: d.raw,
                message: `eGFR ${egfr}: metformin is contraindicated below 30.`,
              });
            else if (egfr < 45)
              findings.push({
                severity: 'WARNING',
                type: 'RENAL',
                drug: d.raw,
                message: `eGFR ${egfr}: reduce metformin dose and review.`,
              });
          } else if (d.name.includes('enoxaparin')) {
            if (egfr < 30)
              findings.push({
                severity: 'WARNING',
                type: 'RENAL',
                drug: d.raw,
                message: `eGFR ${egfr}: enoxaparin dose adjustment required.`,
              });
          } else if (egfr < 30) {
            findings.push({
              severity: 'CRITICAL',
              type: 'RENAL',
              drug: d.raw,
              message: `eGFR ${egfr}: avoid NSAIDs.`,
            });
          } else if (egfr < 60) {
            findings.push({
              severity: 'WARNING',
              type: 'RENAL',
              drug: d.raw,
              message: `eGFR ${egfr}: NSAIDs may worsen renal function; use lowest dose briefly.`,
            });
          }
        }
      }
    }

    // Interactions across ordered + current drugs, reported once per pair when an ordered drug is involved
    const all = [...new Set([...drugs.map((d) => d.name), ...current])];
    const ordered = new Set(drugs.map((d) => d.name));
    for (const rule of INTERACTIONS) {
      const a = all.find((x) => rule.a.some((r) => x.includes(r)));
      const b = all.find((x) => rule.b.some((r) => x.includes(r)));
      if (a && b && a !== b && (ordered.has(a) || ordered.has(b))) {
        findings.push({
          severity: rule.severity,
          type: 'INTERACTION',
          drug: `${a} + ${b}`,
          message: rule.message,
        });
      }
    }

    const status = findings.some((f) => f.severity === 'CRITICAL')
      ? 'CRITICAL_BLOCK'
      : findings.some((f) => f.severity === 'WARNING')
        ? 'WARNING'
        : 'SAFE';
    return { status, findings };
  }
}
