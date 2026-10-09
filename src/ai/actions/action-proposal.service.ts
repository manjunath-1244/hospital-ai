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
import { ActionValidatorService } from './action-validator.service';
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
    private readonly validator: ActionValidatorService,
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

    // Reject what cannot work BEFORE a card exists (unknown patient, no open visit, slot taken, duplicate referral ...).
    const payload = await this.validator.validate(typeUpper, input.payload);
    const summary = renderActionSummary(typeUpper, payload);
    const def = ACTION_CATALOGUE[typeUpper];
    const expiryMins = def?.expiresInMinutes ?? 1440;
    const expiresAt = new Date(Date.now() + expiryMins * 60_000);

    const idempotencyRaw = `${user.userId}:${typeUpper}:${JSON.stringify(payload)}`;
    let idempotencyKey = createHash('sha256')
      .update(idempotencyRaw)
      .digest('hex');

    // The same request twice returns the proposal that is still WAITING (or was completed moments ago). A proposal that
    // was declined, expired, failed or completed long ago is history: asking again creates a NEW proposal.
    const existing = await this.actionsRepo.findOne({
      where: { idempotencyKey },
    });
    if (existing) {
      const live =
        existing.status === 'PENDING' && existing.expiresAt > new Date();
      const justDone =
        existing.status === 'DONE' &&
        Date.now() - (existing.decidedAt?.getTime() ?? 0) < 10 * 60_000;
      if (live || justDone) {
        this.logger.log(`Idempotent proposal match found: ${existing.id}`);
        // Asked again in another conversation: the card is shown there now, so a typed "yes" there must reach it
        // (same user, same request; only the conversation it is attached to moves).
        if (live && input.threadId && existing.threadId !== input.threadId) {
          existing.threadId = input.threadId;
          existing.traceId = input.traceId ?? existing.traceId;
          return this.actionsRepo.save(existing);
        }
        return existing;
      }
      idempotencyKey = `${idempotencyKey}:${Date.now()}`;
    }

    const action = this.actionsRepo.create({
      id: newId('ACT', 8),
      threadId: input.threadId,
      traceId: input.traceId,
      proposedByUserId: user.userId,
      proposedByRole: user.role,
      patientId: input.patientId || payload?.patientId,
      visitId: input.visitId || payload?.visitId,
      type: typeUpper,
      tier,
      payload,
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
      this.logger.warn(
        `Failed to broadcast action proposal event: ${err.message}`,
      );
    }

    return saved;
  }
}
