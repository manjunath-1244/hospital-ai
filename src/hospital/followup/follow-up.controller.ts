import { Controller, Get, Param, Post } from '@nestjs/common';
import { FollowUpService } from './follow-up.service';
import { AuthUser, CurrentUser } from '../../security/auth-user';

@Controller('hospital/visits')
export class FollowUpController {
  constructor(private readonly followUpService: FollowUpService) {}

  @Post(':visitId/follow-up/propose')
  async proposeFollowUp(
    @Param('visitId') visitId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const res = await this.followUpService.generateProposal(visitId, user);
    return { success: true, ...res };
  }

  @Get(':visitId/follow-up')
  async getFollowUpPlan(@Param('visitId') visitId: string) {
    const plan = await this.followUpService.getPlanForVisit(visitId);
    return { success: true, plan };
  }
}
