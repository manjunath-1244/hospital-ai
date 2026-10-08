import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsultationRequestEntity } from '../../database/entities/consultation-request.entity';
import { HospitalService } from '../hospital.service';
import { ClinicalRecordsService } from '../clinical-records.service';
import { KnowledgeDocumentsService } from '../../ai/rag/knowledge-documents.service';

export interface AiReferralSummary {
  referralId: string;
  patientId: string;
  visitId: string;
  specialty: string;
  urgency: string;
  reason: string;
  aiRationale?: string;
  evidence?: any[];
  keyClinicalFindings: {
    recentVitals?: any;
    abnormalLabs?: any[];
    currentMedications?: string[];
    conditions?: string[];
  };
  guidelinesCited: { title: string; filename: string }[];
  generatedAt: string;
}

@Injectable()
export class SpecialistSummaryService {
  constructor(
    @InjectRepository(ConsultationRequestEntity)
    private readonly referralRepo: Repository<ConsultationRequestEntity>,
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly knowledge: KnowledgeDocumentsService,
  ) {}

  async generateSummary(referralId: string): Promise<AiReferralSummary> {
    const referral = await this.referralRepo.findOne({
      where: { id: referralId },
    });
    if (!referral) {
      throw new NotFoundException(`Referral ${referralId} not found`);
    }

    const patient = await this.hospital.getPatientById(referral.patientId);
    const labs = await this.hospital.getPatientLabs(referral.patientId);
    const vitals = await this.records.listVitals(referral.patientId, 1);

    const abnormalLabs = labs
      .filter((l) => l.status === 'ABNORMAL' || l.status === 'CRITICAL')
      .map((l) => ({
        test: l.testName,
        value: l.value,
        unit: l.unit,
        status: l.status,
      }));

    const docs = await this.knowledge.list();
    const relevantDocs = docs
      .filter((d) =>
        d.title.toLowerCase().includes(referral.specialty.toLowerCase()),
      )
      .map((d) => ({ title: d.title, filename: d.filename }));

    return {
      referralId: referral.id,
      patientId: referral.patientId,
      visitId: referral.visitId,
      specialty: referral.specialty,
      urgency: referral.urgency,
      reason: referral.reason,
      aiRationale: referral.aiRationale || undefined,
      evidence: Array.isArray(referral.evidence)
        ? referral.evidence
        : referral.evidence
          ? [referral.evidence]
          : [],
      keyClinicalFindings: {
        recentVitals: vitals.length ? vitals[0] : undefined,
        abnormalLabs,
        currentMedications: patient.currentMedications || [],
        conditions: patient.conditions || [],
      },
      guidelinesCited: relevantDocs,
      generatedAt: new Date().toISOString(),
    };
  }
}
