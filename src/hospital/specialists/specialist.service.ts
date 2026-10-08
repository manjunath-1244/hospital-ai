import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { DoctorAvailabilityEntity } from '../../database/entities/doctor-availability.entity';
import { AppointmentEntity } from '../../database/entities/appointment.entity';
import { newId } from '../../common/ids';
import {
  generateSlots,
  isOfferedSlot,
  isValidWindow,
  slotKey,
  WeeklyWindow,
} from './availability';

export interface SpecialistView {
  id: string;
  name: string;
  role: string;
  specialty: string | null;
  department: string | null;
  isAvailable: boolean;
}

const DEFAULT_RANGE_DAYS = 14;

/** Who can be referred to / booked with, and when they are free. Read side for the referral workflow and the agent. */
@Injectable()
export class SpecialistService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(DoctorAvailabilityEntity)
    private readonly hours: Repository<DoctorAvailabilityEntity>,
    @InjectRepository(AppointmentEntity)
    private readonly appointments: Repository<AppointmentEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private view(u: UserEntity): SpecialistView {
    return {
      id: u.id,
      name: u.displayName,
      role: u.role,
      specialty: u.specialty,
      department: u.department,
      isAvailable: u.isAvailable,
    };
  }

  /** Specialists, optionally of one specialty (case-insensitive). Doctors are not specialists. */
  async find(
    opts: { specialty?: string; onlyAvailable?: boolean } = {},
  ): Promise<SpecialistView[]> {
    const qb = this.users
      .createQueryBuilder('u')
      .where(`u.role = 'SPECIALIST'`)
      .orderBy('u."displayName"');
    if (opts.specialty?.trim())
      qb.andWhere('lower(u.specialty) = lower(:s)', {
        s: opts.specialty.trim(),
      });
    if (opts.onlyAvailable) qb.andWhere('u."isAvailable" = true');
    return (await qb.getMany()).map((u) => this.view(u));
  }

  /** Staff accounts grouped by role (names only; no patient data). */
  async staffByRole() {
    const users = await this.users.find({ order: { displayName: 'ASC' } });
    const byRole: Record<
      string,
      Array<{ name: string; specialty: string | null; isAvailable: boolean }>
    > = {};
    for (const u of users)
      (byRole[u.role] ??= []).push({
        name: u.displayName,
        specialty: u.specialty,
        isAvailable: u.isAvailable,
      });
    return byRole;
  }

  /** The distinct specialties on offer (drives the referral UI and the agent's choices; nothing hardcoded). */
  async specialties(): Promise<string[]> {
    const rows: { specialty: string }[] = await this.users
      .createQueryBuilder('u')
      .select('DISTINCT u.specialty', 'specialty')
      .where(`u.role = 'SPECIALIST' AND u.specialty IS NOT NULL`)
      .orderBy('u.specialty')
      .getRawMany();
    return rows.map((r) => r.specialty);
  }

  async get(doctorId: string): Promise<UserEntity> {
    const u = await this.users.findOne({ where: { id: doctorId } });
    if (!u || !['SPECIALIST', 'DOCTOR'].includes(u.role))
      throw new NotFoundException(`Doctor ${doctorId} not found`);
    return u;
  }

  weeklyHours(doctorId: string): Promise<DoctorAvailabilityEntity[]> {
    return this.hours.find({
      where: { doctorId },
      order: { weekday: 'ASC', startTime: 'ASC' },
    });
  }

  /** Free slots in the next `days` days (default 14), earliest first. */
  async getAvailability(
    doctorId: string,
    opts: { from?: Date; to?: Date; limit?: number; now?: Date } = {},
  ) {
    const doctor = await this.get(doctorId);
    const now = opts.now ?? new Date();
    const from = opts.from ?? now;
    const to =
      opts.to ?? new Date(from.getTime() + DEFAULT_RANGE_DAYS * 86_400_000);
    const windows = await this.weeklyHours(doctorId);
    const booked = await this.bookedKeys(doctorId);
    const slots = doctor.isAvailable
      ? generateSlots(windows, { from, to, now }, booked, opts.limit ?? 50)
      : [];
    return { doctor: this.view(doctor), slots };
  }

  async nextFreeSlot(
    doctorId: string,
    now = new Date(),
  ): Promise<string | null> {
    const { slots } = await this.getAvailability(doctorId, {
      now,
      limit: 1,
      to: new Date(now.getTime() + 60 * 86_400_000),
    });
    return slots[0] ?? null;
  }

  /** Throws 409 unless the doctor can be booked at `dateTime` (available, a real slot, not taken). */
  async assertBookable(
    doctorId: string,
    dateTime: string,
  ): Promise<UserEntity> {
    const doctor = await this.get(doctorId);
    if (!doctor.isAvailable)
      throw new ConflictException(`${doctor.displayName} is not available.`);
    const windows = await this.weeklyHours(doctorId);
    if (!isOfferedSlot(windows, dateTime))
      throw new ConflictException(
        `${dateTime} is not one of ${doctor.displayName}'s appointment slots. Ask for their availability first.`,
      );
    if ((await this.bookedKeys(doctorId)).has(slotKey(dateTime)))
      throw new ConflictException(
        `${doctor.displayName} is already booked at ${dateTime}.`,
      );
    return doctor;
  }

  private async bookedKeys(doctorId: string): Promise<Set<string>> {
    const rows = await this.appointments.find({
      where: { doctorId, status: 'SCHEDULED' },
      select: { dateTime: true },
    });
    return new Set(rows.map((r) => slotKey(r.dateTime)));
  }

  async setAvailable(doctorId: string, isAvailable: boolean) {
    const u = await this.get(doctorId);
    u.isAvailable = isAvailable;
    return this.view(await this.users.save(u));
  }

  /** Replaces the doctor's weekly hours (admin). */
  async setWeeklyHours(doctorId: string, windows: WeeklyWindow[]) {
    await this.get(doctorId);
    const bad = windows.find((w) => !isValidWindow(w));
    if (bad)
      throw new BadRequestException(
        `Invalid working window: ${JSON.stringify(bad)}`,
      );
    await this.dataSource.transaction(async (m) => {
      await m.delete(DoctorAvailabilityEntity, { doctorId });
      await m.save(
        DoctorAvailabilityEntity,
        windows.map((w) =>
          m.create(DoctorAvailabilityEntity, {
            id: newId('AVL-'),
            doctorId,
            ...w,
          }),
        ),
      );
    });
    return this.weeklyHours(doctorId);
  }
}
