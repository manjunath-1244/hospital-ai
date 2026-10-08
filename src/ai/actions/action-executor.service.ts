import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentActionEntity } from '../../database/entities/agent-action.entity';
import { HospitalLifecycleService } from '../../hospital/hospital-lifecycle.service';
import { HospitalService } from '../../hospital/hospital.service';
import { ClinicalRecordsService } from '../../hospital/clinical-records.service';
import { VisitsService } from '../../hospital/visits/visits.service';
import { AuthUser } from '../../security/auth-user';
import { canApproveAction } from './action-policy';
import { HospitalEventsGateway } from '../../events/hospital-events.gateway';
import {
  RegistrationDto,
  ConsultationDto,
  AppointmentDto,
} from '../../hospital/dto/hospital.dto';

@Injectable()
export class ActionExecutorService {
  private readonly logger = new Logger(ActionExecutorService.name);

  constructor(
    @InjectRepository(AgentActionEntity)
    private readonly actionsRepo: Repository<AgentActionEntity>,
    private readonly lifecycle: HospitalLifecycleService,
    private readonly hospital: HospitalService,
    private readonly records: ClinicalRecordsService,
    private readonly visits: VisitsService,
    private readonly eventsGateway: HospitalEventsGateway,
  ) {}

  async approveAndExecute(
    actionId: string,
    approver: AuthUser,
    decisionNote?: string,
  ): Promise<AgentActionEntity> {
    const action = await this.actionsRepo.findOne({ where: { id: actionId } });
    if (!action) {
      throw new NotFoundException(`Action ${actionId} not found`);
    }

    // Idempotent execution
    if (action.status === 'DONE') {
      this.logger.log(`Action ${actionId} already DONE. Returning result.`);
      return action;
    }

    if (action.status !== 'PENDING') {
      throw new BadRequestException(
        `Action ${actionId} cannot be approved in status ${action.status}`,
      );
    }

    if (new Date() > action.expiresAt) {
      action.status = 'EXPIRED';
      await this.actionsRepo.save(action);
      throw new BadRequestException(`Action ${actionId} has expired`);
    }

    if (!canApproveAction(action.type, approver.role)) {
      throw new ForbiddenException(
        `Role ${approver.role} is not authorized to approve action ${action.type}`,
      );
    }

    if (action.tier === 'ASK_HUMAN' && action.type === 'CONSULTATION') {
      if (!decisionNote || decisionNote.trim().length < 5) {
        throw new BadRequestException(
          'Human approval for consultation requires a written override note (at least 5 characters).',
        );
      }
    }

    action.status = 'EXECUTING';
    action.decidedByUserId = approver.userId;
    action.decidedAt = new Date();
    action.decisionNote = decisionNote;
    await this.actionsRepo.save(action);

    let executionResult: any = null;
    const checks: string[] = [];

    try {
      const p = action.payload;

      switch (action.type) {
        case 'REGISTER_PATIENT': {
          const dto = Object.assign(new RegistrationDto(), p);
          executionResult = await this.lifecycle.registerOutpatient(dto, approver);
          checks.push(`Registered patient ${executionResult.patient.id}`);
          break;
        }

        case 'APPOINTMENT': {
          const dto = Object.assign(new AppointmentDto(), p);
          executionResult = await this.lifecycle.bookAppointment(dto);
          checks.push(`Booked appointment ${executionResult.id ?? ''}`);
          break;
        }

        case 'STAFF_TASK': {
          executionResult = await this.lifecycle.createTask({
            title: p.title,
            assignedTo: p.assignedToRole || p.assignedTo || 'staff',
            patientId: p.patientId,
            priority: p.priority ?? 'MEDIUM',
          });
          checks.push(`Created task ${executionResult.id ?? ''}`);
          break;
        }

        case 'CONSULTATION': {
          const dto = Object.assign(new ConsultationDto(), {
            ...p,
            overrideReason: decisionNote || p.overrideReason,
          });
          executionResult = await this.lifecycle.recordDoctorConsultation(dto, approver);
          checks.push(`Recorded consultation for patient ${p.patientId}`);
          break;
        }

        case 'REFERRAL':
        case 'FOLLOW_UP':
        case 'NOTIFICATION':
        case 'LAB_ORDER': {
          // Execution generates staff task / notification record
          executionResult = await this.lifecycle.createTask({
            title: `${action.type} Action Approved: ${action.summary}`,
            assignedTo: 'doctor',
            patientId: action.patientId,
            priority: 'HIGH',
          });
          checks.push(`Issued workflow task for ${action.type}`);
          break;
        }

        default:
          throw new BadRequestException(`Unsupported action type: ${action.type}`);
      }

      // Read-back verification
      let verified = false;
      if (action.patientId || executionResult?.patient?.id) {
        const targetId = action.patientId || executionResult?.patient?.id;
        const patientData = await this.hospital.getPatientById(targetId);
        if (patientData && patientData.id === targetId) {
          verified = true;
          checks.push(`Read-back verified: Patient record ${targetId} exists in DB.`);
        }
      } else {
        verified = true;
        checks.push('Read-back verified: Execution returned success result.');
      }

      action.status = 'DONE';
      action.result = executionResult;
      action.verification = { verified, checks };
      await this.actionsRepo.save(action);

      // Broadcast execution event
      try {
        this.eventsGateway.emitActionExecuted({
          actionId: action.id,
          type: action.type,
          status: 'DONE',
          decidedBy: approver.userId,
        });
      } catch (err: any) {
        this.logger.warn(`Failed to broadcast action execution event: ${err.message}`);
      }

      return action;
    } catch (err: any) {
      this.logger.error(`Execution failed for action ${actionId}: ${err.message}`);
      action.status = 'FAILED';
      action.verification = {
        verified: false,
        checks,
        error: err.message,
      };
      await this.actionsRepo.save(action);
      throw err;
    }
  }

  async decline(
    actionId: string,
    approver: AuthUser,
    reason?: string,
  ): Promise<AgentActionEntity> {
    const action = await this.actionsRepo.findOne({ where: { id: actionId } });
    if (!action) {
      throw new NotFoundException(`Action ${actionId} not found`);
    }

    if (action.status !== 'PENDING') {
      throw new BadRequestException(
        `Action ${actionId} cannot be declined in status ${action.status}`,
      );
    }

    action.status = 'DECLINED';
    action.decidedByUserId = approver.userId;
    action.decidedAt = new Date();
    action.decisionNote = reason;
    await this.actionsRepo.save(action);

    try {
      this.eventsGateway.emitActionDecided({
        actionId: action.id,
        type: action.type,
        status: 'DECLINED',
        decidedBy: approver.userId,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to broadcast action decline event: ${err.message}`);
    }

    return action;
  }
}
