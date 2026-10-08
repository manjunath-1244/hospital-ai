import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AgentActionEntity,
  ActionStatus,
} from '../../database/entities/agent-action.entity';
import { ActionExecutorService } from './action-executor.service';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../../security/auth-user';

export class ActionDecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) overrideReason?: string;
  @IsOptional() @IsString() @MaxLength(1000) decisionNote?: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

@Controller('ai/actions')
export class ActionsController {
  constructor(
    @InjectRepository(AgentActionEntity)
    private readonly actionsRepo: Repository<AgentActionEntity>,
    private readonly executor: ActionExecutorService,
  ) {}

  @Get()
  async listActions(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('patientId') patientId?: string,
    @Query('limit') limit?: string,
  ) {
    const qb = this.actionsRepo.createQueryBuilder('a');
    // Everyone sees their own proposals; only an admin sees everyone's.
    if (user.role !== 'ADMIN')
      qb.andWhere('a.proposedByUserId = :me', { me: user.userId });
    if (status) {
      qb.andWhere('a.status = :status', { status });
    }
    if (patientId) {
      qb.andWhere('a.patientId = :patientId', { patientId });
    }
    qb.orderBy('a.createdAt', 'DESC');
    qb.take(limit ? Math.min(Number(limit) || 50, 100) : 50);

    const items = await qb.getMany();
    return { success: true, count: items.length, actions: items };
  }

  @Get(':id')
  async getAction(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const action = await this.actionsRepo.findOne({ where: { id } });
    if (
      !action ||
      (user.role !== 'ADMIN' && action.proposedByUserId !== user.userId)
    ) {
      return { success: false, error: 'Action not found' };
    }
    return { success: true, action };
  }

  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() dto: ActionDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const note = dto.overrideReason || dto.decisionNote;
    const action = await this.executor.approveAndExecute(id, user, note);
    return { success: true, action };
  }

  @Post(':id/decline')
  async decline(
    @Param('id') id: string,
    @Body() dto: ActionDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const action = await this.executor.decline(
      id,
      user,
      dto.reason || dto.decisionNote,
    );
    return { success: true, action };
  }
}
