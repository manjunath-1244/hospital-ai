export type ReferralSpecialty = 'Cardiology' | 'Neurology';
export type ReferralUrgency = 'EMERGENCY' | 'URGENT' | 'ROUTINE';
export type ReferralRecommendationType =
  'SPECIALIST' | 'NONE' | 'NEEDS_DOCTOR_REVIEW';

export interface EvidenceItem {
  field: string;
  value: string;
  source: string;
}

export interface RuleMatch {
  ruleId: string;
  specialty: ReferralSpecialty;
  urgency: ReferralUrgency;
  description: string;
  matchedFacts: EvidenceItem[];
}

export interface ReferralRulesResult {
  triggered: boolean;
  matches: RuleMatch[];
  historicalOnlyCandidates: string[];
  missingInfo: string[];
}

export interface ReferralRecommendation {
  recommendation: ReferralRecommendationType;
  specialty: ReferralSpecialty | null;
  urgency: ReferralUrgency | null;
  rationale: string[];
  evidence: EvidenceItem[];
  missingInfo: string[];
  confidence: number;
  verification: {
    verified: boolean;
    unverifiedEvidence: EvidenceItem[];
    reason?: string;
  };
  proposal: any | null;
}
