import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from './security/roles.decorator';

@Controller()
export class AppController {
  constructor(private readonly ds: DataSource) {}

  /** Liveness/readiness for load balancers. Reveals nothing beyond up/down. */
  @Public()
  @Get('health')
  async health() {
    await this.ds.query('SELECT 1');
    return { status: 'ok' };
  }
}
