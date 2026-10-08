import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HospitalService } from './hospital.service';
import { VisitsService } from './visits/visits.service';
import { HospitalEventsGateway } from '../events/hospital-events.gateway';

/** Periodically flags visits that have waited past the policy limit, once per visit (persisted via waitAlertedAt). */
@Injectable()
export class QueueMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMonitorService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly hospital: HospitalService,
    private readonly visits: VisitsService,
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
      const late = await this.visits.findWaitingLongerThan(limit, true);
      for (const v of late) {
        const patient = await this.hospital.getPatientById(v.patientId);
        this.events.emitUnconsultedAlert({
          patientId: patient.id,
          visitId: v.id,
          name: patient.name,
          waitTimeMinutes: Math.floor(
            (Date.now() - v.arrivedAt.getTime()) / 60_000,
          ),
        });
      }
      await this.visits.markWaitAlerted(late.map((v) => v.id));
      if (late.length)
        this.logger.warn(
          `${late.length} patient(s) exceeded the ${limit} min consultation wait.`,
        );
    } catch (err: any) {
      this.logger.error(`Queue monitor tick failed: ${err.message}`);
    }
  }
}
