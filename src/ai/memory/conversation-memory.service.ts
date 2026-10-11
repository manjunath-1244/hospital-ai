import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatThreadEntity } from '../../database/entities/chat-thread.entity';
import { ChatMessageEntity } from '../../database/entities/chat-message.entity';
import { newId } from '../../common/ids';
import type { AuthUser } from '../../security/auth-user';
import { Msg, selectWindow } from './context-window';

export type SummarizeFn = (
  previousSummary: string | null,
  messages: Msg[],
) => Promise<string>;

export interface BuiltContext {
  summary: string | null;
  recent: Msg[];
  /** True when older turns were (or already had been) folded into the summary. */
  summarized: boolean;
}

/**
 * ============================================================================
 * 🧠 CONCEPT: MEMORY (Short-Term Window & Long-Term Rolling Summary)
 * ============================================================================
 * WHAT IT IS:
 * Dual-tier conversational memory enabling natural multi-turn medical dialogues:
 * 1. Short-Term Memory: Stores full verbatim conversation turns (user & assistant)
 *    persisted in PostgreSQL (`chat_messages`), bounded by a token window (`AI_CONTEXT_TOKENS`).
 * 2. Long-Term Memory: When the token budget is reached, older turns are automatically
 *    summarized into a high-density clinical summary (`chat_threads.summary`), preserving
 *    key findings (e.g. "discussed P1001 diabetes labs") without overflowing LLM context.
 * 3. Active Patient Focus: Tracks `activePatientId` across turns so pronouns ("her", "him", "them")
 *    naturally resolve to the active patient.
 *
 * PRIVACY & ISOLATION:
 * - Thread-level access isolation: Users can only read/continue their own threads.
 * - Thread titles are generated safely from first turn text.
 * ============================================================================
 * Persistent conversation memory. Short-term = the recent turns that fit the token budget;
 * long-term = a rolling summary of everything older, plus the patient currently in focus.
 */
@Injectable()
export class ConversationMemoryService {
  private readonly logger = new Logger(ConversationMemoryService.name);

  constructor(
    @InjectRepository(ChatThreadEntity)
    private readonly threads: Repository<ChatThreadEntity>,
    @InjectRepository(ChatMessageEntity)
    private readonly messages: Repository<ChatMessageEntity>,
  ) {}

  async getOrCreateThread(
    user: AuthUser,
    threadId: string | undefined,
    firstMessage: string,
  ): Promise<ChatThreadEntity> {
    if (threadId) {
      // A thread is private to its owner; other users get the same 404 as for a missing id.
      const t = await this.threads.findOne({
        where: { id: threadId, userId: user.userId },
      });
      if (!t) throw new NotFoundException('Conversation not found');
      return t;
    }
    return this.threads.save(
      this.threads.create({
        id: newId('THR-', 10),
        userId: user.userId,
        title:
          firstMessage.replace(/\s+/g, ' ').trim().slice(0, 60) ||
          'New conversation',
        summary: null,
        summarizedCount: 0,
        activePatientId: null,
      }),
    );
  }

  async buildContext(
    thread: ChatThreadEntity,
    summarize: SummarizeFn,
    budgetTokens = Number(process.env.AI_CONTEXT_TOKENS ?? 3000),
  ): Promise<BuiltContext> {
    const all = await this.messages.find({
      where: { threadId: thread.id },
      order: { createdAt: 'ASC' },
    });
    const { older, recent } = selectWindow(all, budgetTokens);

    let summarized = older.length > 0 && !!thread.summary;
    if (older.length > thread.summarizedCount) {
      try {
        thread.summary = await summarize(
          thread.summary,
          older.slice(thread.summarizedCount),
        );
        thread.summarizedCount = older.length;
        await this.threads.save(thread);
        summarized = true;
      } catch (err: any) {
        // Degrade, don't fail the user's request: answer with what we have and try again next turn.
        this.logger.warn(
          `Summarisation failed for ${thread.id}: ${err.message}`,
        );
      }
    }
    return {
      summary: thread.summary,
      recent: recent.map((m) => ({ role: m.role, content: m.content })),
      summarized,
    };
  }

  async append(threadId: string, role: 'user' | 'assistant', content: string) {
    await this.messages.save(this.messages.create({ threadId, role, content }));
    await this.threads.update({ id: threadId }, { updatedAt: new Date() });
  }

  async setActivePatient(
    thread: ChatThreadEntity,
    patientId: string | null | undefined,
  ) {
    if (patientId && patientId.toUpperCase() !== thread.activePatientId) {
      thread.activePatientId = patientId.toUpperCase();
      await this.threads.update(
        { id: thread.id },
        { activePatientId: thread.activePatientId },
      );
    }
  }

  async countMessages(threadId: string) {
    return this.messages.count({ where: { threadId } });
  }

  async listThreads(user: AuthUser) {
    const rows = await this.threads.find({
      where: { userId: user.userId },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updatedAt,
      activePatientId: t.activePatientId,
    }));
  }

  async getThread(user: AuthUser, id: string) {
    const t = await this.threads.findOne({
      where: { id, userId: user.userId },
    });
    if (!t) throw new NotFoundException('Conversation not found');
    const messages = await this.messages.find({
      where: { threadId: id },
      order: { createdAt: 'ASC' },
    });
    return {
      id: t.id,
      title: t.title,
      summary: t.summary,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
  }

  async deleteThread(user: AuthUser, id: string) {
    const t = await this.threads.findOne({
      where: { id, userId: user.userId },
    });
    if (!t) throw new NotFoundException('Conversation not found');
    await this.messages.delete({ threadId: id });
    await this.threads.delete({ id });
    return { success: true };
  }
}
