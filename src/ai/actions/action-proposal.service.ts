import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AgentActionEntity } from '../../database/entities/agent-action.entity';
import {
  ACTION_CATALOGUE,
  canProposeAction,
  getActionTier,
  renderActionSummary,
} from './action-policy';
import { AuthUser } from '../../security/auth-user';
import { HospitalEventsGateway } from '../../events/hospital-events.gateway';
import { newId } from '../../common/ids';

export interface ProposeActionInput {
  type: string;
  payload: Record<string, any>;
  patientId?: string;
  visitId?: string;
  threadId?: string;
  traceId?: string;
}

@Injectable()
export class ActionProposalService {
  private readonly logger = new Logger(ActionProposalService.name);

  constructor(
    @InjectRepository(AgentActionEntity)
    private readonly actionsRepo: Repository<AgentActionEntity>,
    private readonly eventsGateway: HospitalEventsGateway,
  ) {}

  async propose(
    input: ProposeActionInput,
    user: AuthUser,
  ): Promise<AgentActionEntity> {
    const typeUpper = input.type.toUpperCase();

    if (!canProposeAction(typeUpper, user.role)) {
      throw new ForbiddenException(
        `Role ${user.role} is not authorized to propose action ${typeUpper}`,
      );
    }

    const tier = getActionTier(typeUpper);
    if (tier === 'NEVER') {
      throw new ForbiddenException(
        `Action type ${typeUpper} is forbidden (NEVER tier)`,
      );
    }

    const summary = renderActionSummary(typeUpper, input.payload);
    const def = ACTION_CATALOGUE[typeUpper];
    const expiryMins = def?.expiresInMinutes ?? 1440;
    const expiresAt = new Date(Date.now() + expiryMins * 60_000);

    const idempotencyRaw = `${user.userId}:${typeUpper}:${JSON.stringify(
      input.payload,
    )}`;
    const idempotencyKey = createHash('sha256')
      .update(idempotencyRaw)
      .digest('hex');

    // Check existing proposal for idempotency
    const existing = await this.actionsRepo.findOne({
      where: { idempotencyKey },
    });
    if (existing) {
      this.logger.log(`Idempotent proposal match found: ${existing.id}`);
      return existing;
    }

    const action = this.actionsRepo.create({
      id: newId('ACT', 8),
      threadId: input.threadId,
      traceId: input.traceId,
      proposedByUserId: user.userId,
      proposedByRole: user.role,
      patientId: input.patientId || input.payload?.patientId,
      visitId: input.visitId || input.payload?.visitId,
      type: typeUpper,
      tier,
      payload: input.payload,
      summary,
      status: 'PENDING',
      expiresAt,
      idempotencyKey,
    });

    const saved = await this.actionsRepo.save(action);

    // Broadcast proposal event
    try {
      this.eventsGateway.emitActionProposed({
        actionId: saved.id,
        type: saved.type,
        tier: saved.tier,
        summary: saved.summary,
        patientId: saved.patientId,
        proposedBy: saved.proposedByUserId,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to broadcast action proposal event: ${err.message}`);
    }

    return saved;
  }
}
