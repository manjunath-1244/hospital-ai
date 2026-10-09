import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { AgentActionEntity } from '../../database/entities/agent-action.entity';
import type { AuthUser } from '../../security/auth-user';
import { ActionExecutorService } from './action-executor.service';
import { WEAK_CONFIRM } from '../query/lexicon';

/** A bare "yes" only answers a proposal made this recently; an older one needs its id or its card. */
export const BARE_CONFIRM_WINDOW_MS = 10 * 60 * 1000;

export type PendingReply = { text: string; actionIds: string[] };

/**
 * "Yes, go ahead" / "No, cancel" typed in the chat are replies to the proposals WAITING in THIS conversation, and to
 * nothing else. With nothing waiting they do nothing and say so; with several they ask which. The decision goes
 * through the same executor as the Approve/Decline buttons (same role, ownership, expiry and verification rules).
 */
@Injectable()
export class PendingActionsService {
  constructor(
    @InjectRepository(AgentActionEntity)
    private readonly actions: Repository<AgentActionEntity>,
    private readonly executor: ActionExecutorService,
  ) {}

  pendingFor(user: AuthUser, threadId: string): Promise<AgentActionEntity[]> {
    return this.actions.find({
      where: {
        threadId,
        proposedByUserId: user.userId,
        status: 'PENDING',
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async reply(
    kind: 'CONFIRM' | 'DECLINE',
    message: string,
    user: AuthUser,
    threadId: string,
  ): Promise<PendingReply> {
    const pending = await this.pendingFor(user, threadId);
    if (!pending.length)
      return {
        text:
          kind === 'CONFIRM'
            ? 'Nothing is waiting for your confirmation in this conversation, so I did nothing. Tell me what you would like to do.'
            : 'There is nothing waiting to be cancelled in this conversation.',
        actionIds: [],
      };

    // "confirm ACT12345" picks one; otherwise a single RECENT pending proposal is unambiguous.
    const named = message.match(/\bACT[A-Z0-9]{8}\b/i)?.[0]?.toUpperCase();
    if (kind === 'CONFIRM' && !named && WEAK_CONFIRM.test(message.trim()))
      return {
        text: `"${message.trim()}" is an acknowledgement, not an approval, so nothing was done. To approve, say "confirm" (or "confirm <id>") or use the card: ${pending.map((a) => `${a.summary} (${a.id})`).join('; ')}`,
        actionIds: pending.map((a) => a.id),
      };
    const recent = pending.filter(
      (a) => Date.now() - a.createdAt.getTime() <= BARE_CONFIRM_WINDOW_MS,
    );
    if (kind === 'CONFIRM' && !named && !recent.length)
      return {
        text: `The proposal waiting in this conversation is older than ${BARE_CONFIRM_WINDOW_MS / 60000} minutes, so a plain "yes" does not approve it. Say "confirm <id>" or use its card: ${pending.map((a) => `${a.summary} (${a.id})`).join('; ')}`,
        actionIds: pending.map((a) => a.id),
      };
    const pool = named || kind === 'DECLINE' ? pending : recent;
    const chosen = named
      ? pending.find((a) => a.id === named)
      : pool.length === 1
        ? pool[0]
        : undefined;
    if (!chosen) {
      const list = pending.map((a) => `• ${a.summary} (${a.id})`).join('\n');
      return {
        text: `${named ? `No waiting proposal in this conversation has the id ${named}. ` : ''}${pending.length} ${pending.length === 1 ? 'proposal is' : 'proposals are'} waiting. Which one do you mean? Say "${kind === 'CONFIRM' ? 'confirm' : 'decline'} <id>", or use the buttons on the cards:\n${list}`,
        actionIds: pending.map((a) => a.id),
      };
    }

    if (kind === 'DECLINE') {
      await this.executor.decline(chosen.id, user, 'Declined in chat');
      return {
        text: `Declined. Nothing was done: ${chosen.summary} (${chosen.id}).`,
        actionIds: [chosen.id],
      };
    }
    if (chosen.tier === 'ASK_HUMAN')
      return {
        text: `This one needs your written reason or override note, so please use its card: ${chosen.summary} (${chosen.id}).`,
        actionIds: [chosen.id],
      };
    try {
      const done = await this.executor.approveAndExecute(chosen.id, user);
      const checks = done.verification?.checks?.length
        ? `\nVerified: ${done.verification.checks.join('; ')}`
        : '';
      return {
        text:
          done.status === 'DONE'
            ? `Done: ${done.summary} (${done.id}).${checks}`
            : `It was not completed (${done.status}): ${done.summary} (${done.id}).${checks}`,
        actionIds: [done.id],
      };
    } catch (err: any) {
      return {
        text: `It could not be done: ${err?.message ?? 'the action was refused'}. Nothing was changed. (${chosen.id})`,
        actionIds: [chosen.id],
      };
    }
  }
}
