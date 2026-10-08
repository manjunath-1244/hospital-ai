import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HospitalService } from './hospital.service';
import { HospitalEventsGateway } from '../events/hospital-events.gateway';

/** Periodically flags patients who have waited past the policy limit, once per patient (persisted via waitAlertedAt). */
@Injectable()
export class QueueMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMonitorService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly hospital: HospitalService,
    private readonly events: HospitalEventsGateway,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const limit = Number(process.env.WAIT_ALERT_MINUTES ?? 30);
      const late = await this.hospital.findWaitingLongerThan(limit, true);
      for (const p of late) {
        this.events.emitUnconsultedAlert({
          patientId: p.id,
          name: p.name,
          waitTimeMinutes: Math.floor(
            (Date.now() - p.registeredAt.getTime()) / 60_000,
          ),
        });
      }
      await this.hospital.markWaitAlerted(late.map((p) => p.id));
      if (late.length)
        this.logger.warn(
          `${late.length} patient(s) exceeded the ${limit} min consultation wait.`,
        );
    } catch (err: any) {
      this.logger.error(`Queue monitor tick failed: ${err.message}`);
    }
  }
}
