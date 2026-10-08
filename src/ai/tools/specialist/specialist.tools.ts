import { z } from 'zod';
import { ReferralRecommendationService } from '../../../hospital/referrals/referral-recommendation.service';
import { SpecialistService } from '../../../hospital/specialists/specialist.service';
import { looseInt } from '../loose-schema';
import { ClinicalTool } from '../tool-registry';

export function buildSpecialistTools(d: {
  specialists: SpecialistService;
  referrals: ReferralRecommendationService;
}): ClinicalTool[] {
  return [
    {
      name: 'reviewReferralNeed',
      description:
        'Rules-based review of ONE patient: is a specialist referral indicated (Cardiology/Neurology) from the CURRENT visit data, with the evidence, missing information and a verification flag. Read-only decision support; creates nothing. Use for "is a specialist required?" and before proposing a referral.',
      inputSchema: z.object({ patientId: z.string() }),
      roles: ['DOCTOR', 'NURSE', 'ADMIN'],
      requires: { patientBound: true },
      async run({ patientId }) {
        return {
          success: true,
          ...(await d.referrals.evaluatePatient(patientId)),
        };
      },
    },
    {
      name: 'getStaffSummary',
      description:
        'How many staff accounts there are per role (doctors, nurses, pharmacists, radiologists, receptionists, care coordinators, specialists) and their names. Use for "how many doctors/nurses are there".',
      inputSchema: z.object({}),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      async run() {
        return { success: true, byRole: await d.specialists.staffByRole() };
      },
    },
    {
      name: 'findSpecialists',
      description:
        'List specialists (id, name, specialty, whether they are available). Optionally only one specialty, e.g. Cardiology or Neurology. Use it before booking or referring so you use a real doctor id.',
      inputSchema: z.object({ specialty: z.string().optional() }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      async run({ specialty }) {
        return {
          success: true,
          specialties: await d.specialists.specialties(),
          specialists: await d.specialists.find({ specialty }),
        };
      },
    },
    {
      name: 'getSpecialistAvailability',
      description:
        'Free appointment slots (ISO date-times, earliest first) for one specialist by doctor id, plus the next free slot. Never invent a time: book only one of these.',
      inputSchema: z.object({
        doctorId: z.string(),
        limit: looseInt({ min: 1, max: 50 }).default(10),
      }),
      roles: ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'CARE_COORDINATOR', 'ADMIN'],
      async run({ doctorId, limit }) {
        const { doctor, slots } = await d.specialists.getAvailability(
          doctorId,
          {
            limit,
          },
        );
        return { success: true, doctor, nextFreeSlot: slots[0] ?? null, slots };
      },
    },
  ];
}
