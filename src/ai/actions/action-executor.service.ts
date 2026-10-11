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
import { LabOrdersService } from '../../hospital/labs/lab-orders.service';
import { NotificationService } from '../../hospital/notifications/notification.service';
import { SpecialistService } from '../../hospital/specialists/specialist.service';
import { FollowUpPlanEntity } from '../../database/entities/follow-up-plan.entity';
import { ReferralService } from '../../hospital/referrals/referral.service';
import { AuthUser } from '../../security/auth-user';
import { canApproveAction } from './action-policy';
import { HospitalEventsGateway } from '../../events/hospital-events.gateway';
import {
  RegistrationDto,
  ConsultationDto,
  AppointmentDto,
} from '../../hospital/dto/hospital.dto';

/**
 * ============================================================================
 * 🔀 CONCEPT: Workflows (Multi-Step Execution Control & Human-in-the-Loop)
 * ============================================================================
 * WHAT IT IS:
 * Deterministic multi-step execution control that orchestrates complex operations
 * with validation, role authorizations, state transitions, atomic database commits,
 * and read-back verifications.
 *
 * HOW IMPLEMENTED:
 * - Human-in-the-Loop (HITL) Life Cycle:
 *   1. AI Agent creates a proposal with tier classification (`AUTO` vs `ASK_HUMAN`).
 *   2. Proposal saved in PostgreSQL as `PENDING` with expiration time (`expiresAt`).
 *   3. Clinician receives interactive UI card or reviews in action queue.
 *   4. Atomically transitions state: `PENDING` -> `EXECUTING` (prevents double execution).
 *   5. Executes step payload (e.g. register patient, book specialist, record Rx, order lab).
 *   6. Performs deterministic read-back verification directly from database.
 *   7. Marks status as `DONE` or `FAILED` and broadcasts via WebSocket events.
 *
 * USE CASE:
 * Prevents autonomous AI from directly altering clinical records or ordering medications
 * without licensed clinician review, ensuring complete clinical auditability and patient safety.
 * ============================================================================
 */
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
    private readonly referralService: ReferralService,
    private readonly labOrders: LabOrdersService,
    private readonly notifications: NotificationService,
    private readonly specialists: SpecialistService,
    @InjectRepository(FollowUpPlanEntity)
    private readonly plans: Repository<FollowUpPlanEntity>,
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

    this.assertMayDecide(action, approver);
    if (!canApproveAction(action.type, approver.role)) {
      throw new ForbiddenException(
        `Role ${approver.role} is not authorized to approve action ${action.type}`,
      );
    }

    // A consultation is signed in the approver's name, so only the clinician who proposed it may approve it.
    if (
      action.type === 'CONSULTATION' &&
      action.proposedByUserId !== approver.userId
    )
      throw new ForbiddenException(
        'A consultation can only be approved (and signed) by the clinician who proposed it.',
      );

    if (action.tier === 'ASK_HUMAN' && action.type === 'CONSULTATION') {
      if (!decisionNote || decisionNote.trim().length < 5) {
        throw new BadRequestException(
          'Human approval for consultation requires a written override note (at least 5 characters).',
        );
      }
    }

    // Claim the proposal atomically: of two simultaneous approvals (button + chat "yes", double click) exactly one
    // flips PENDING -> EXECUTING; the other sees zero affected rows and never runs the executor.
    const decidedAt = new Date();
    const claim = await this.actionsRepo.update(
      { id: action.id, status: 'PENDING' },
      {
        status: 'EXECUTING',
        decidedByUserId: approver.userId,
        decidedAt,
        decisionNote,
      },
    );
    if (!claim.affected) {
      const now = await this.actionsRepo.findOne({ where: { id: action.id } });
      if (now?.status === 'DONE') return now;
      throw new BadRequestException(
        `Action ${actionId} is already being handled (status ${now?.status ?? 'unknown'})`,
      );
    }
    action.status = 'EXECUTING';
    action.decidedByUserId = approver.userId;
    action.decidedAt = decidedAt;
    action.decisionNote = decisionNote;

    let executionResult: any = null;
    let verified: boolean | undefined;
    const checks: string[] = [];

    try {
      const p = action.payload;

      switch (action.type) {
        case 'REGISTER_PATIENT': {
          const dto = Object.assign(new RegistrationDto(), p);
          executionResult = await this.lifecycle.registerOutpatient(
            dto,
            approver,
          );
          checks.push(`Registered patient ${executionResult.patient.id}`);
          const stored = await this.hospital.getPatientById(
            executionResult.patient.id,
          );
          verified = stored?.id === executionResult.patient.id;
          checks.push(
            verified
              ? `Read-back verified: patient ${stored.id} (${stored.name}) is stored.`
              : 'Read-back FAILED: the new patient record was not found.',
          );
          break;
        }

        case 'APPOINTMENT': {
          const dto = Object.assign(new AppointmentDto(), p);
          executionResult = await this.lifecycle.bookAppointment(dto);
          checks.push(`Booked appointment ${executionResult.id ?? ''}`);
          const booked = (
            await this.hospital.getAppointmentsForPatient(p.patientId)
          ).find((a) => a.id === executionResult.id);
          verified = !!booked;
          checks.push(
            verified
              ? `Read-back verified: appointment ${booked!.id} is stored for ${new Date(booked!.dateTime).toISOString()}.`
              : 'Read-back FAILED: the appointment was not found for this patient.',
          );
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
          verified = (await this.hospital.getTasks()).some(
            (t) => t.id === executionResult.id,
          );
          checks.push(
            verified
              ? `Read-back verified: task ${executionResult.id} is stored.`
              : 'Read-back FAILED: the task was not found.',
          );
          break;
        }

        case 'CONSULTATION': {
          const dto = Object.assign(new ConsultationDto(), {
            ...p,
            overrideReason: decisionNote || p.overrideReason,
          });
          executionResult = await this.lifecycle.recordDoctorConsultation(
            dto,
            approver,
          );
          checks.push(`Recorded consultation for patient ${p.patientId}`);
          verified = await this.lifecycle.consultationStored(
            p.patientId,
            executionResult.consultationId,
          );
          checks.push(
            verified
              ? `Read-back verified: consultation ${executionResult.consultationId} is stored.`
              : 'Read-back FAILED: the consultation was not found.',
          );
          break;
        }

        case 'REFERRAL': {
          executionResult = await this.referralService.createReferral(
            {
              visitId: p.visitId,
              patientId: p.patientId || action.patientId,
              specialty: p.specialty,
              assignedSpecialistId: p.assignedSpecialistId,
              urgency: p.urgency || 'ROUTINE',
              reason: p.reason,
              aiRationale: p.aiRationale,
              evidence: p.evidence,
            },
            approver,
          );
          checks.push(`Created consultation_request ${executionResult.id}`);
          break;
        }

        case 'LAB_ORDER': {
          const visit = await this.visits.requireActive(p.patientId);
          const order = await this.labOrders.createLabOrder(
            {
              visitId: visit.id,
              patientId: visit.patientId,
              testName: p.testName,
            },
            approver,
          );
          executionResult = order;
          checks.push(`Created lab order ${order.id} (${order.testName})`);
          verified = (
            await this.labOrders.listLabOrders({ patientId: order.patientId })
          ).some((o) => o.id === order.id);
          checks.push(
            verified
              ? `Read-back verified: lab order ${order.id} is stored.`
              : `Read-back FAILED: lab order ${order.id} not found.`,
          );
          break;
        }

        case 'NOTIFICATION': {
          const toPatient = p.recipientType === 'PATIENT';
          if (toPatient) {
            const notice = await this.notifications.createPatientNotice({
              patientId: p.recipientTarget || p.patientId,
              visitId: p.visitId ?? null,
              message: p.message,
              channel: 'STUB',
            });
            executionResult = notice;
            checks.push(
              `Stored patient notice ${notice.id} (stub channel: not actually delivered)`,
            );
            verified = !!notice.id;
          } else {
            const target = await this.resolveRecipients(
              p.recipientType,
              p.recipientTarget,
            );
            if (!target.length)
              throw new BadRequestException(
                `No staff account matches recipient "${p.recipientTarget}".`,
              );
            const sent: any[] = [];
            for (const userId of target)
              sent.push(
                await this.notifications.sendNotification({
                  recipientUserId: userId,
                  type: p.notificationType ?? 'GENERAL',
                  title: `Message from ${approver.userName}`,
                  body: p.message,
                  payload: { patientId: p.patientId ?? null },
                  sourceActionId: action.id,
                }),
              );
            executionResult = sent;
            checks.push(`Sent in-app notification to ${sent.length} user(s)`);
            verified = sent.every((n) => !!n.id);
          }
          checks.push(
            verified
              ? 'Read-back verified: notification record stored.'
              : 'Read-back FAILED.',
          );
          break;
        }

        case 'FOLLOW_UP': {
          const outcome = await this.executeFollowUp(action, approver, checks);
          executionResult = outcome.results;
          verified = outcome.verified;
          break;
        }

        default:
          throw new BadRequestException(
            `Unsupported action type: ${action.type}`,
          );
      }

      // Read-back verification. Types that verify their own record above set `verified`; the rest are checked here.
      if (verified === undefined) {
        const targetId = action.patientId || executionResult?.patient?.id;
        if (action.type === 'REFERRAL') {
          const stored = await this.referralService.getReferral(
            executionResult.id,
          );
          verified =
            stored?.id === executionResult.id && stored.status === 'REQUESTED';
          checks.push(
            verified
              ? `Read-back verified: referral ${stored.id} is stored as REQUESTED.`
              : 'Read-back FAILED: referral not found.',
          );
        } else if (targetId) {
          const patientData = await this.hospital.getPatientById(targetId);
          verified = patientData?.id === targetId;
          checks.push(
            `Read-back verified: patient record ${targetId} exists. (${action.type} id: ${executionResult?.id ?? 'n/a'})`,
          );
        } else {
          verified = !!executionResult;
          checks.push('Read-back verified: execution returned a result.');
        }
      }
      if (!verified)
        throw new Error(`Read-back verification failed: ${checks.join(' | ')}`);

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
        this.logger.warn(
          `Failed to broadcast action execution event: ${err.message}`,
        );
      }

      return action;
    } catch (err: any) {
      this.logger.error(
        `Execution failed for action ${actionId}: ${err.message}`,
      );
      action.status = 'FAILED';
      // A multi-item action (follow-up plan) may have completed some items before one failed: say so, and keep what
      // was created, so nobody believes nothing happened (or that everything did).
      const partial =
        Array.isArray(executionResult) && executionResult.length > 0;
      if (partial) action.result = executionResult;
      action.verification = {
        verified: false,
        checks,
        error: err.message,
        ...(partial ? { partial: true } : {}),
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

    this.assertMayDecide(action, approver);
    if (action.status !== 'PENDING') {
      throw new BadRequestException(
        `Action ${actionId} cannot be declined in status ${action.status}`,
      );
    }

    const decided = await this.actionsRepo.update(
      { id: action.id, status: 'PENDING' },
      {
        status: 'DECLINED',
        decidedByUserId: approver.userId,
        decidedAt: new Date(),
        decisionNote: reason,
      },
    );
    if (!decided.affected)
      throw new BadRequestException(
        `Action ${actionId} was already decided and cannot be declined`,
      );
    action.status = 'DECLINED';
    action.decidedByUserId = approver.userId;
    action.decidedAt = new Date();
    action.decisionNote = reason;

    try {
      this.eventsGateway.emitActionDecided({
        actionId: action.id,
        type: action.type,
        status: 'DECLINED',
        decidedBy: approver.userId,
      });
    } catch (err: any) {
      this.logger.warn(
        `Failed to broadcast action decline event: ${err.message}`,
      );
    }

    return action;
  }

  /** Only the person who asked for an action (or an admin) may approve or decline it. */
  private assertMayDecide(action: AgentActionEntity, user: AuthUser) {
    if (user.role !== 'ADMIN' && action.proposedByUserId !== user.userId)
      throw new ForbiddenException(
        'Only the person who requested this action, or an admin, can decide it.',
      );
  }

  /** USER = an account id; ROLE = every account with that role or specialty. */
  private async resolveRecipients(
    type: string,
    target: string,
  ): Promise<string[]> {
    if (type === 'USER') return target ? [target] : [];
    return this.specialists.recipientIdsForRole(target);
  }

  /** Carries out every item of an approved follow-up plan for real and reads each one back. */
  private async executeFollowUp(
    action: AgentActionEntity,
    approver: AuthUser,
    checks: string[],
  ): Promise<{ results: any[]; verified: boolean }> {
    const p = action.payload;
    const plan = await this.plans.findOne({ where: { id: p.planId } });
    if (!plan)
      throw new NotFoundException(`Follow-up plan ${p.planId} not found`);
    const visit = await this.visits.requireActive(plan.patientId);
    const results: any[] = [];
    let allOk = true;
    for (const item of plan.items) {
      try {
        const d = item.details ?? {};
        if (item.type === 'APPOINTMENT') {
          const from = new Date(Date.now() + (d.days ?? 28) * 86_400_000);
          const { slots } = await this.specialists.getAvailability(d.doctorId, {
            from,
            limit: 1,
          });
          if (!slots.length)
            throw new Error(
              `${d.doctorName} has no free slot on or after ${from.toISOString().slice(0, 10)}`,
            );
          const appt: any = await this.lifecycle.bookAppointment(
            Object.assign(new AppointmentDto(), {
              patientId: plan.patientId,
              doctorId: d.doctorId,
              dateTime: slots[0],
              reason: d.reason ?? 'Follow-up',
            }),
          );
          const stored = (
            await this.hospital.getAppointmentsForPatient(plan.patientId)
          ).some((a) => a.id === appt.id);
          allOk &&= stored;
          checks.push(
            stored
              ? `Booked appointment ${appt.id} with ${d.doctorName} at ${slots[0]} (read back)`
              : `Appointment ${appt.id} NOT found on read-back`,
          );
          results.push(appt);
        } else if (item.type === 'LAB_ORDER') {
          const order = await this.labOrders.createLabOrder(
            {
              visitId: visit.id,
              patientId: plan.patientId,
              testName: d.testName,
            },
            approver,
          );
          const stored = (
            await this.labOrders.listLabOrders({ patientId: plan.patientId })
          ).some((o) => o.id === order.id);
          allOk &&= stored;
          checks.push(
            stored
              ? `Ordered ${order.testName} (${order.id}, read back)`
              : `Lab order ${order.id} NOT found on read-back`,
          );
          results.push(order);
        } else if (item.type === 'TASK') {
          const task = await this.lifecycle.createTask({
            title: d.title ?? item.summary,
            assignedTo: d.assignedToRole ?? 'staff',
            patientId: plan.patientId,
            priority: d.priority ?? 'MEDIUM',
          });
          const stored = (
            await this.hospital.getTasksForPatient(plan.patientId)
          ).some((t) => t.id === task.id);
          allOk &&= stored;
          checks.push(
            stored
              ? `Created task ${task.id} (read back)`
              : `Task ${task.id} NOT found on read-back`,
          );
          results.push(task);
        } else if (item.type === 'PATIENT_NOTICE') {
          const notice = await this.notifications.createPatientNotice({
            patientId: plan.patientId,
            visitId: visit.id,
            message: d.message,
            channel: 'STUB',
          });
          allOk &&= !!notice.id;
          checks.push(
            `Stored patient notice ${notice.id} (stub channel: not actually delivered)`,
          );
          results.push(notice);
        }
      } catch (err: any) {
        allOk = false;
        checks.push(`FAILED: ${item.summary} (${err.message})`);
      }
    }
    plan.status = allOk ? 'APPROVED' : plan.status;
    await this.plans.save(plan);
    return { results, verified: allOk };
  }
}
