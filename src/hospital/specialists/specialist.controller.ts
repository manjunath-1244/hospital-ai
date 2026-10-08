import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { SpecialistService } from './specialist.service';
import { SpecialistPortalService, CompleteConsultationDto } from './specialist-portal.service';
import { AuthUser, CurrentUser } from '../../security/auth-user';
import { Roles } from '../../security/roles.decorator';

@Controller('hospital/specialists')
export class SpecialistController {
  constructor(
    private readonly specialistService: SpecialistService,
    private readonly portalService: SpecialistPortalService,
  ) {}

  @Get()
  async listSpecialists(
    @Query('specialty') specialty?: string,
    @Query('onlyAvailable') onlyAvailable?: string,
  ) {
    const isOnlyAvailable = onlyAvailable === 'true' || onlyAvailable === '1';
    const items = await this.specialistService.find({
      specialty,
      onlyAvailable: isOnlyAvailable,
    });
    return { success: true, count: items.length, specialists: items };
  }

  @Get('specialties')
  async listSpecialties() {
    const specialties = await this.specialistService.specialties();
    return { success: true, specialties };
  }

  @Get('me/consultations')
  @Roles('SPECIALIST', 'DOCTOR', 'ADMIN')
  async getMyConsultations(@CurrentUser() user: AuthUser) {
    const items = await this.portalService.getMyConsultations(user);
    return { success: true, count: items.length, consultations: items };
  }

  @Get(':id/availability')
  async getAvailability(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const avail = await this.specialistService.getAvailability(id, {
      limit: limit ? Number(limit) : 50,
    });
    return { success: true, ...avail };
  }

  @Patch(':id/availability')
  @Roles('ADMIN', 'SPECIALIST')
  async setAvailable(
    @Param('id') id: string,
    @Body('isAvailable') isAvailable: boolean,
  ) {
    const updated = await this.specialistService.setAvailable(id, Boolean(isAvailable));
    return { success: true, specialist: updated };
  }

  @Put(':id/hours')
  @Roles('ADMIN')
  async setHours(
    @Param('id') id: string,
    @Body('windows') windows: any[],
  ) {
    const updated = await this.specialistService.setWeeklyHours(id, windows || []);
    return { success: true, hours: updated };
  }
}
