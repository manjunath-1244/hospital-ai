import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { VisitsService } from '../../hospital/visits/visits.service';
import { isActiveStatus } from '../../hospital/visits/visit-status';
import type { AuthUser } from '../../security/auth-user';
import type { AgentContext } from './agent-context';

/** Assembles the per-request context from the database (the permissions part is added by `applyToolPolicy`). */
@Injectable()
export class AgentContextBuilder {
  constructor(
    private readonly visits: VisitsService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async build(input: {
    user: AuthUser;
    /** Patients named in this message (or implied by "him/her"). */
    subjectIds: string[];
    thread: {
      id: string | null;
      activePatientId: string | null;
      summarized: boolean;
    };
  }): Promise<Omit<AgentContext, 'permissions'>> {
    const subjects = input.subjectIds.map((i) => i.toUpperCase());
    const focus = input.thread.activePatientId?.toUpperCase() ?? null;
    const allowed = [...new Set([...subjects, ...(focus ? [focus] : [])])];
    const primary = subjects[0] ?? focus;

    let visit: AgentContext['visit'] = null;
    if (primary) {
      const open = await this.visits.getActive(primary);
      const latest = open ?? (await this.visits.listForPatient(primary, 1))[0];
      if (latest)
        visit = {
          id: latest.id,
          status: latest.status,
          isOpen: isActiveStatus(latest.status),
          priority: latest.priority,
        };
    }
    const account = await this.users.findOne({
      where: { id: input.user.userId },
      select: { specialty: true },
    });
    return {
      user: {
        id: input.user.userId,
        role: input.user.role,
        specialty: account?.specialty ?? null,
      },
      patient: primary ? { id: primary } : null,
      allowedPatientIds: allowed,
      visit,
      conversation: {
        threadId: input.thread.id,
        summarized: input.thread.summarized,
      },
      now: new Date().toISOString(),
    };
  }
}
