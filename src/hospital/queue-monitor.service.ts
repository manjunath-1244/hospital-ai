import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HospitalService } from './hospital.service';
import { VisitsService } from './visits/visits.service';
import { HospitalEventsGateway } from '../events/hospital-events.gateway';

/**
 * ============================================================================
 * ⏱️ CONCEPT: Background Queue Monitor & Emergency SLA Escalation Daemon
 * ============================================================================
 * WHAT IT IS:
 * Proactive background surveillance daemon monitoring patient waiting times in emergency
 * and outpatient clinics, enforcing hospital Service Level Agreements (SLAs).
 *
 * HOW IMPLEMENTED:
 * - Recurring Scheduled Polling (`setInterval` / `tick`):
 *   Runs periodic sweeps (every 60s) for patients waiting longer than the policy threshold
 *   (`WAIT_ALERT_MINUTES`, default 30 min) without doctor consultation.
 * - Reactive Alert Broadcasts:
 *   Emits WebSocket `events.emitUnconsultedAlert` to emergency staff consoles.
 * - Idempotent Alert Flagging (`markWaitAlerted`):
 *   Marks `waitAlertedAt` timestamps on visit records so clinicians are alerted exactly
 *   once per breach rather than bombarded with duplicate alarms.
 *
 * USE CASE:
 * Prevents clinical abandonment in overcrowded waiting rooms, ensuring patients who
 * experience prolonged wait times are flagged for immediate triage reassessment.
 * ============================================================================
 * Periodically flags visits that have waited past the policy limit, once per visit (persisted via waitAlertedAt).
 */
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
