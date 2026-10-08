import { z } from 'zod';
import { SpecialistService } from '../../../hospital/specialists/specialist.service';
import { looseInt } from '../loose-schema';
import { ClinicalTool } from '../tool-registry';

export function buildSpecialistTools(d: {
  specialists: SpecialistService;
}): ClinicalTool[] {
  return [
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
