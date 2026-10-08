import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
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
