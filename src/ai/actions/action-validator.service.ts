import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HospitalService } from '../../hospital/hospital.service';
import { HospitalLifecycleService } from '../../hospital/hospital-lifecycle.service';
import { VisitsService } from '../../hospital/visits/visits.service';
import { SpecialistService } from '../../hospital/specialists/specialist.service';
import { ConsultationRequestEntity } from '../../database/entities/consultation-request.entity';
import { FollowUpPlanEntity } from '../../database/entities/follow-up-plan.entity';
import { ACTION_CATALOGUE } from './action-policy';
import { validateDto } from '../tools/validate-dto';
import {
  ConsultationDto,
  RegistrationDto,
} from '../../hospital/dto/hospital.dto';

/** A proposal that cannot be carried out, with what the caller should ask or offer instead (never a card for it). */
export class ProposalRejected extends BadRequestException {
  constructor(
    message: string,
    readonly detail: {
      needs?: string[];
      suggestions?: unknown;
      possibleMatches?: unknown;
    } = {},
  ) {
    super({ message, ...detail });
  }
}

/**
 * Checks a proposal against the real system state BEFORE a card exists, so the user is never asked to approve something
 * that cannot work: unknown patient, no open visit, a slot that is not free, an unknown specialty, a duplicate referral,
 * a plan that does not exist, a registration that looks like an existing patient. Execution re-checks everything.
 */
@Injectable()
export class ActionValidatorService {
  constructor(
    private readonly hospital: HospitalService,
    private readonly lifecycle: HospitalLifecycleService,
    private readonly visits: VisitsService,
    private readonly specialists: SpecialistService,
    @InjectRepository(ConsultationRequestEntity)
    private readonly referrals: Repository<ConsultationRequestEntity>,
    @InjectRepository(FollowUpPlanEntity)
    private readonly plans: Repository<FollowUpPlanEntity>,
  ) {}

  /** Returns the payload to store (possibly enriched, e.g. with the safety preview); throws ProposalRejected otherwise. */
  async validate(
    type: string,
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const def = ACTION_CATALOGUE[type];
    const out = { ...payload };

    if (typeof out.patientId === 'string' && out.patientId) {
      const patient = await this.hospital.getPatientById(out.patientId); // 404 text names the id
      out.patientId = patient.id;
      if (def?.requiresOpenVisit) {
        const visit = await this.visits.getActive(patient.id);
        if (!visit)
          throw new ProposalRejected(
            `Patient ${patient.id} has no open visit, so this cannot be done. Start a visit (reception) or reopen the last one first.`,
          );
        out.visitId = visit.id;
      }
    } else if (def?.requiresOpenVisit) {
      throw new ProposalRejected('A patient is required.', {
        needs: ['patientId'],
      });
    }

    switch (type) {
      case 'APPOINTMENT': {
        const needs = ['doctorId', 'dateTime', 'reason'].filter((k) => !out[k]);
        if (needs.length)
          throw new ProposalRejected(
            `To book an appointment I still need: ${needs.join(', ')}.`,
            { needs },
          );
        try {
          await this.specialists.assertBookable(out.doctorId, out.dateTime);
        } catch (err: any) {
          const free = await this.specialists
            .getAvailability(out.doctorId, { limit: 5 })
            .catch(() => ({ slots: [] as string[] }));
          throw new ProposalRejected(String(err?.message ?? err), {
            suggestions: { nextFreeSlots: free.slots },
          });
        }
        return out;
      }
      case 'REFERRAL': {
        const known = await this.specialists.specialties();
        const match = known.find(
          (s) =>
            s.toLowerCase() ===
            String(out.specialty ?? '')
              .trim()
              .toLowerCase(),
        );
        if (!match)
          throw new ProposalRejected(
            `"${out.specialty}" is not a specialty on offer. Available: ${known.join(', ') || 'none'}.`,
            { suggestions: { specialties: known } },
          );
        out.specialty = match;
        const open = await this.referrals
          .createQueryBuilder('r')
          .where(
            'r."visitId" = :v AND r.specialty = :s AND r.status IN (:...st)',
            {
              v: out.visitId,
              s: match,
              st: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'],
            },
          )
          .getOne();
        if (open)
          throw new ConflictException(
            `A ${match} referral (${open.id}, ${open.status}) is already open for this visit.`,
          );
        return out;
      }
      case 'REGISTER_PATIENT': {
        const dto = await validateDto(RegistrationDto, out);
        if (!dto.allowDuplicate) {
          const matches = await this.lifecycle.previewDuplicates(dto);
          if (matches.length)
            throw new ProposalRejected(
              'This looks like a patient who is already registered. Ask whether it is the same person; only propose again with allowDuplicate=true if they confirm it is a different person.',
              { possibleMatches: matches },
            );
        }
        return { ...out, ...dto };
      }
      case 'CONSULTATION': {
        await validateDto(ConsultationDto, out);
        const patient = await this.hospital.getPatientById(out.patientId);
        const safety = await this.lifecycle.screenMedications(
          patient,
          out.prescriptions ?? [],
        );
        out.safetyPreview = {
          status: safety.status,
          findings: safety.findings.filter((f) => f.severity !== 'INFO'),
        };
        out.requiresOverride = safety.status === 'CRITICAL_BLOCK';
        return out;
      }
      case 'LAB_ORDER':
        if (!out.testName || String(out.testName).trim().length < 2)
          throw new ProposalRejected('Which test should be ordered?', {
            needs: ['testName'],
          });
        return out;
      case 'STAFF_TASK':
        if (!out.title || !(out.assignedToRole || out.assignedTo))
          throw new ProposalRejected(
            'A task needs a title and who it is for.',
            { needs: ['title', 'assignedTo'] },
          );
        return out;
      case 'FOLLOW_UP': {
        const plan = out.planId
          ? await this.plans.findOne({ where: { id: String(out.planId) } })
          : null;
        if (!plan)
          throw new ProposalRejected(
            'This follow-up proposal has no plan. Generate the plan from the visit first.',
          );
        if (plan.patientId !== out.patientId)
          throw new ProposalRejected(
            `Follow-up plan ${plan.id} belongs to a different patient.`,
          );
        return out;
      }
      case 'NOTIFICATION': {
        if (out.recipientType === 'PATIENT') return out; // patient existence checked above when patientId is given
        if (out.recipientType === 'USER') {
          const found = Object.values(await this.specialists.staffByRole())
            .flat()
            .some((s) => s.id === out.recipientTarget);
          if (!found)
            throw new ProposalRejected(
              `No staff account has the id "${out.recipientTarget}".`,
            );
        } else {
          const group = await this.specialists.recipientIdsForRole(
            String(out.recipientTarget ?? ''),
          );
          if (!group.length)
            throw new ProposalRejected(
              `No staff in "${out.recipientTarget}" to notify.`,
            );
        }
        return out;
      }
      default:
        return out;
    }
  }
}
