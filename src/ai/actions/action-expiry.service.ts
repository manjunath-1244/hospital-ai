import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AgentActionEntity } from '../../database/entities/agent-action.entity';

@Injectable()
export class ActionExpiryService implements OnModuleInit {
  private readonly logger = new Logger(ActionExpiryService.name);

  constructor(
    @InjectRepository(AgentActionEntity)
    private readonly actionsRepo: Repository<AgentActionEntity>,
  ) {}

  onModuleInit() {
    // Run expiry sweep on startup and every 5 minutes
    this.sweepExpiredActions();
    this.sweepStuckExecutions();
    setInterval(() => {
      void this.sweepExpiredActions();
      void this.sweepStuckExecutions();
    }, 5 * 60_000);
  }

  async sweepExpiredActions(): Promise<number> {
    try {
      const expired = await this.actionsRepo.find({
        where: {
          status: 'PENDING',
          expiresAt: LessThan(new Date()),
        },
      });

      if (expired.length === 0) return 0;

      for (const action of expired) {
        action.status = 'EXPIRED';
      }

      await this.actionsRepo.save(expired);
      this.logger.log(`Swept ${expired.length} expired pending agent actions.`);
      return expired.length;
    } catch (err: any) {
      this.logger.warn(`Failed to sweep expired actions: ${err.message}`);
      return 0;
    }
  }

  /**
   * An action left EXECUTING (process stopped mid-run) is not retried blindly: the side effect may or may not have
   * happened. It becomes FAILED with an explicit "outcome unknown" note so a person checks the record and re-proposes.
   */
  async sweepStuckExecutions(olderThanMs = 5 * 60_000): Promise<number> {
    try {
      const stuck = await this.actionsRepo.find({
        where: {
          status: 'EXECUTING',
          decidedAt: LessThan(new Date(Date.now() - olderThanMs)),
        },
      });
      for (const a of stuck) {
        a.status = 'FAILED';
        a.verification = {
          verified: false,
          checks: [],
          error:
            'Execution was interrupted and its outcome is unknown. Check the record before proposing it again.',
        };
      }
      if (stuck.length) {
        await this.actionsRepo.save(stuck);
        this.logger.warn(`Marked ${stuck.length} interrupted actions FAILED.`);
      }
      return stuck.length;
    } catch (err: any) {
      this.logger.warn(`Failed to sweep stuck actions: ${err.message}`);
      return 0;
    }
  }
}
