import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AiService } from './ai.service';
import { ChatDto, DocumentDto } from './ai.dto';
import { ConversationMemoryService } from './memory/conversation-memory.service';
import { AuthUser, CurrentUser } from '../security/auth-user';

@Controller('ai')
@Throttle({ default: { limit: 20, ttl: 60_000 } }) // LLM calls are expensive
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly memory: ConversationMemoryService,
  ) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  chat(@Body() dto: ChatDto, @CurrentUser() user: AuthUser) {
    return this.ai.chat(user, dto);
  }

  @Post('chat/stream')
  @HttpCode(HttpStatus.OK)
  async chatStream(
    @Body() dto: ChatDto,
    @CurrentUser() user: AuthUser,
    @Res() res: any,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      for await (const chunk of this.ai.chatStream(user, dto)) {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch (err: any) {
      res.write(
        `data: ${JSON.stringify({ error: String(err?.message ?? err) })}\n\n`,
      );
    } finally {
      res.end();
    }
  }

  @Post('documents')
  @HttpCode(HttpStatus.OK)
  documents(@Body() dto: DocumentDto, @CurrentUser() user: AuthUser) {
    return this.ai.generateDocument(user, dto);
  }

  @Get('threads')
  threads(@CurrentUser() user: AuthUser) {
    return this.memory.listThreads(user);
  }

  @Get('threads/:id')
  thread(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.memory.getThread(user, id);
  }

  @Delete('threads/:id')
  deleteThread(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.memory.deleteThread(user, id);
  }
}
