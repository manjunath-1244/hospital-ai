import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CreateReferralDto, ReferralService } from './referral.service';
import type { ReferralStatus } from '../../database/entities/consultation-request.entity';
import { AuthUser, CurrentUser } from '../../security/auth-user';
import { Roles } from '../../security/roles.decorator';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ForbiddenException } from '@nestjs/common';

import {
  SpecialistPortalService,
  CompleteConsultationDto,
} from '../specialists/specialist-portal.service';

export class UpdateReferralStatusDto {
  @IsIn(['REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  toStatus!: ReferralStatus;
  @IsOptional() @IsString() @MaxLength(500) cancellationReason?: string;
}

@Controller('hospital/referrals')
export class ReferralsController {
  constructor(
    private readonly referralService: ReferralService,
    private readonly portalService: SpecialistPortalService,
  ) {}

  /** The signed-in specialist's inbox: assigned to them, or unassigned in their specialty; most urgent first. */
  @Get('mine')
  @Roles('SPECIALIST')
  async mine(@CurrentUser() user: AuthUser) {
    const items = await this.referralService.withPatientInfo(
      await this.referralService.listForSpecialist(user.userId),
    );
    return { success: true, count: items.length, referrals: items };
  }

  @Post()
  @Roles('DOCTOR', 'NURSE', 'ADMIN')
  async createReferral(
    @Body() dto: CreateReferralDto,
    @CurrentUser() user: AuthUser,
  ) {
    const referral = await this.referralService.createReferral(dto, user);
    return { success: true, referral };
  }

  @Get()
  @Roles('DOCTOR', 'NURSE', 'ADMIN')
  async listReferrals(
    @Query('patientId') patientId?: string,
    @Query('visitId') visitId?: string,
    @Query('assignedSpecialistId') assignedSpecialistId?: string,
    @Query('specialty') specialty?: string,
    @Query('status') status?: string,
  ) {
    const items = await this.referralService.withPatientInfo(
      await this.referralService.listReferrals({
        patientId,
        visitId,
        assignedSpecialistId,
        specialty,
        status: status as ReferralStatus | undefined,
      }),
    );
    return { success: true, count: items.length, referrals: items };
  }

  @Get(':id')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'SPECIALIST')
  async getReferral(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (user.role === 'SPECIALIST')
      await this.referralService.assertSpecialistOwns(user.userId, id);
    const [referral] = await this.referralService.withPatientInfo([
      await this.referralService.getReferral(id),
    ]);
    return { success: true, referral };
  }

  @Get(':id/ai-summary')
  @Roles('DOCTOR', 'ADMIN', 'SPECIALIST')
  async getAiSummary(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    if (user.role === 'SPECIALIST')
      await this.referralService.assertSpecialistOwns(user.userId, id);
    const summary = await this.portalService.getAiSummary(id);
    return { success: true, summary };
  }

  @Post(':id/complete')
  @Roles('SPECIALIST', 'ADMIN')
  async completeReferral(
    @Param('id') id: string,
    @Body() dto: CompleteConsultationDto,
    @CurrentUser() user: AuthUser,
  ) {
    const res = await this.portalService.completeConsultation(id, dto, user);
    return { success: true, ...res };
  }

  @Patch(':id/status')
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'SPECIALIST')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateReferralStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (user.role === 'SPECIALIST')
      await this.referralService.assertSpecialistOwns(user.userId, id);
    else if (dto.toStatus !== 'CANCELLED')
      throw new ForbiddenException(
        'Only the specialist can progress a referral; staff can cancel it.',
      );
    const referral = await this.referralService.transitionStatus(
      id,
      dto.toStatus,
      user,
      dto.cancellationReason,
    );
    return { success: true, referral };
  }
}
