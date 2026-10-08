export interface Patient {
  id: string;
  name: string;
  age: number;
  gender: string;
  dob: string;
  phone: string;
  bloodType: string;
  allergies: string[];
  currentMedications: string[];
  conditions: string[];
  registeredAt: Date;
}

export type LabStatus = 'NORMAL' | 'ABNORMAL' | 'CRITICAL';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type SafetyStatus = 'SAFE' | 'WARNING' | 'CRITICAL_BLOCK';
export interface SafetyFinding {
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  type:
    | 'ALLERGY'
    | 'CROSS_REACTIVITY'
    | 'DUPLICATE_THERAPY'
    | 'INTERACTION'
    | 'RENAL';
  drug: string;
  message: string;
}
export interface SafetyReport {
  status: SafetyStatus;
  findings: SafetyFinding[];
}
