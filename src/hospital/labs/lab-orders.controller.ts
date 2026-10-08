import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CreateLabOrderDto, LabOrdersService } from './lab-orders.service';
import { LabOrderStatus } from '../../database/entities/lab-order.entity';
import { Roles } from '../../security/roles.decorator';
import { AuthUser, CurrentUser } from '../../security/auth-user';

@Controller('hospital/lab-orders')
export class LabOrdersController {
  constructor(private readonly labOrdersService: LabOrdersService) {}

  @Post()
  @Roles('DOCTOR', 'NURSE', 'ADMIN')
  async createOrder(
    @Body() dto: CreateLabOrderDto,
    @CurrentUser() user: AuthUser,
  ) {
    const order = await this.labOrdersService.createLabOrder(dto, user);
    return { success: true, order };
  }

  @Get()
  @Roles('DOCTOR', 'NURSE', 'ADMIN', 'RADIOLOGIST')
  async listOrders(
    @Query('patientId') patientId?: string,
    @Query('visitId') visitId?: string,
    @Query('status') status?: string,
  ) {
    const items = await this.labOrdersService.listLabOrders({
      patientId,
      visitId,
      status: status as LabOrderStatus | undefined,
    });
    return { success: true, count: items.length, orders: items };
  }
}
