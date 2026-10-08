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
    setInterval(() => this.sweepExpiredActions(), 5 * 60_000);
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
}
