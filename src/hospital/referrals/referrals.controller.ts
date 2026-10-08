import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateReferralDto,
  ReferralService,
} from './referral.service';
import { ReferralStatus } from '../../database/entities/consultation-request.entity';
import { AuthUser, CurrentUser } from '../../security/auth-user';

export class UpdateReferralStatusDto {
  toStatus!: ReferralStatus;
  cancellationReason?: string;
}

@Controller('hospital/referrals')
export class ReferralsController {
  constructor(private readonly referralService: ReferralService) {}

  @Post()
  async createReferral(
    @Body() dto: CreateReferralDto,
    @CurrentUser() user: AuthUser,
  ) {
    const referral = await this.referralService.createReferral(dto, user);
    return { success: true, referral };
  }

  @Get()
  async listReferrals(
    @Query('patientId') patientId?: string,
    @Query('visitId') visitId?: string,
    @Query('assignedSpecialistId') assignedSpecialistId?: string,
    @Query('specialty') specialty?: string,
    @Query('status') status?: string,
  ) {
    const items = await this.referralService.listReferrals({
      patientId,
      visitId,
      assignedSpecialistId,
      specialty,
      status: status as ReferralStatus | undefined,
    });
    return { success: true, count: items.length, referrals: items };
  }

  @Get(':id')
  async getReferral(@Param('id') id: string) {
    const referral = await this.referralService.getReferral(id);
    return { success: true, referral };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateReferralStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    const referral = await this.referralService.transitionStatus(
      id,
      dto.toStatus,
      user,
      dto.cancellationReason,
    );
    return { success: true, referral };
  }
}
