import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  LabOrderEntity,
  LabOrderStatus,
} from '../../database/entities/lab-order.entity';
import { AuthUser } from '../../security/auth-user';
import { newId } from '../../common/ids';

export class CreateLabOrderDto {
  @Matches(/^[A-Za-z0-9-]{2,32}$/) visitId!: string;
  @Matches(/^[A-Za-z0-9-]{2,32}$/) patientId!: string;
  @IsString() @MinLength(2) @MaxLength(120) testName!: string;
}

@Injectable()
export class LabOrdersService {
  private readonly logger = new Logger(LabOrdersService.name);

  constructor(
    @InjectRepository(LabOrderEntity)
    private readonly ordersRepo: Repository<LabOrderEntity>,
  ) {}

  async createLabOrder(
    dto: CreateLabOrderDto,
    orderedBy: AuthUser,
  ): Promise<LabOrderEntity> {
    const userId = orderedBy.userId || (orderedBy as any).id;
    const userName =
      (orderedBy as any).displayName || orderedBy.userName || 'Staff';

    const order = this.ordersRepo.create({
      id: newId('LO', 6),
      visitId: dto.visitId,
      patientId: dto.patientId,
      testName: dto.testName,
      orderedById: userId,
      orderedByName: userName,
      status: 'ORDERED',
    });

    return this.ordersRepo.save(order);
  }

  async listLabOrders(filters: {
    patientId?: string;
    visitId?: string;
    status?: LabOrderStatus;
  }): Promise<LabOrderEntity[]> {
    const qb = this.ordersRepo.createQueryBuilder('o');

    if (filters.patientId) {
      qb.andWhere('o.patientId = :patientId', { patientId: filters.patientId });
    }
    if (filters.visitId) {
      qb.andWhere('o.visitId = :visitId', { visitId: filters.visitId });
    }
    if (filters.status) {
      qb.andWhere('o.status = :status', { status: filters.status });
    }

    qb.orderBy('o.createdAt', 'DESC');
    return qb.getMany();
  }

  async linkResultToOrder(
    patientId: string,
    testName: string,
    resultId: string,
  ): Promise<LabOrderEntity | null> {
    const openOrders = await this.ordersRepo
      .createQueryBuilder('o')
      .where('o.patientId = :patientId', { patientId })
      .andWhere('o.status IN (:...statuses)', {
        statuses: ['ORDERED', 'COLLECTED'],
      })
      .orderBy('o.createdAt', 'ASC')
      .getMany();

    const matchingOrder = openOrders.find(
      (o) =>
        o.testName.toLowerCase().includes(testName.toLowerCase()) ||
        testName.toLowerCase().includes(o.testName.toLowerCase()),
    );

    if (!matchingOrder) {
      return null;
    }

    matchingOrder.status = 'RESULTED';
    matchingOrder.resultId = resultId;
    return this.ordersRepo.save(matchingOrder);
  }
}
