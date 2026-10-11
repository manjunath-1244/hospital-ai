import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { corsOrigins } from '../config/app.config';
import { JwtPayload } from '../security/jwt-auth.guard';
import { UserRole } from '../security/roles.decorator';

const STAFF: UserRole[] = ['DOCTOR', 'NURSE', 'RECEPTIONIST', 'ADMIN'];
const ALL_ROLES: UserRole[] = [
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'ADMIN',
  'PHARMACIST',
  'CARE_COORDINATOR',
  'RADIOLOGIST',
];
const CLINICAL: UserRole[] = ['DOCTOR', 'NURSE', 'ADMIN'];

/**
 * ============================================================================
 * ⚡ CONCEPT: Real-Time WebSocket Events (Live Hospital Event Streaming)
 * ============================================================================
 * WHAT IT IS:
 * Full-duplex WebSocket event gateway that streams live hospital telemetry,
 * emergency physiological alerts, and AI action lifecycle transitions directly
 * to clinician web portals without polling.
 *
 * HOW IMPLEMENTED:
 * - JWT Handshake Authentication:
 *   Validates bearer tokens during initial socket handshake; immediately binds
 *   the connection to the user's role-based room (`role:${payload.role}`) and
 *   user room (`user:${payload.sub}`).
 * - Role-Scoped Event Broadcasting:
 *   Ensures clinical privacy by delivering events strictly to authorized roles
 *   (e.g. `alert.news2_deterioration` only to CLINICAL; `dicom.uploaded` to RADIOLOGIST).
 * - Agent Action Lifecycle Streaming:
 *   Broadcasts `agent.action.proposed`, `agent.action.decided`, and `agent.action.executed`
 *   to update interactive UI cards in real time.
 *
 * USE CASE:
 * Eliminates browser refresh delays; ensures doctors and nurses are instantly
 * notified of deteriorating vital signs, panic lab results, and pending approval cards.
 * ============================================================================
 * Authenticated, role-scoped realtime channel. Clients must present a valid JWT in the handshake
 * (`io(url, { auth: { token } })`); each socket joins a room for its role, and events are only
 * delivered to the roles that need them (no global broadcast of patient data).
 */
@WebSocketGateway({ cors: { origin: corsOrigins(), credentials: true } })
export class HospitalEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(HospitalEventsGateway.name);

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('no token');
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      client.data.user = payload;
      await client.join(`role:${payload.role}`);
      if (payload.sub) {
        await client.join(`user:${payload.sub}`);
      }
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    /* rooms are cleaned up by socket.io */
  }

  get connectedClients(): number {
    return this.server?.engine?.clientsCount ?? 0;
  }

  private emitTo(event: string, payload: unknown, roles: UserRole[]) {
    if (!this.server) {
      this.logger.warn(`Gateway not ready; dropped ${event}`);
      return;
    }
    this.server.to(roles.map((r) => `role:${r}`)).emit(event, payload);
  }

  emitNotificationToUser(userId: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit('notification.new', payload);
  }

  emitReferralCreated(p: unknown) {
    this.emitTo('referral.created', p, [...CLINICAL, 'SPECIALIST']);
  }

  emitReferralUpdated(p: unknown) {
    this.emitTo('referral.updated', p, [...CLINICAL, 'SPECIALIST']);
  }

  // Payloads are deliberately minimal (no phone/DOB/allergy data).
  emitPatientRegistered(p: unknown) {
    this.emitTo('patient.registered', p, STAFF);
  }
  emitDoctorConsulted(p: unknown) {
    this.emitTo('doctor.consulted', p, [
      ...STAFF,
      'PHARMACIST',
      'CARE_COORDINATOR',
    ]);
  }
  emitUnconsultedAlert(p: unknown) {
    this.emitTo('alert.unconsulted_patient', p, STAFF);
  }
  emitCriticalLabAlert(p: unknown) {
    this.emitTo('alert.critical_lab', p, [...CLINICAL, 'PHARMACIST']);
  }
  emitNews2Alert(p: unknown) {
    this.emitTo('alert.news2_deterioration', p, CLINICAL);
  }
  emitDicomUploaded(p: unknown) {
    this.emitTo('dicom.uploaded', p, [...CLINICAL, 'RADIOLOGIST']);
  }

  /** Every visit status change (arrival, triage, consultation, completion, cancellation, reopen). */
  emitVisitUpdated(p: unknown) {
    this.emitTo('visit.updated', p, ALL_ROLES);
  }
  emitPatientDeleted(p: unknown) {
    this.emitTo('patient.deleted', p, ALL_ROLES);
  }

  // Agent action lifecycle events
  emitActionProposed(p: unknown) {
    this.emitTo('agent.action.proposed', p, ALL_ROLES);
  }
  emitActionDecided(p: unknown) {
    this.emitTo('agent.action.decided', p, ALL_ROLES);
  }
  emitActionExecuted(p: unknown) {
    this.emitTo('agent.action.executed', p, ALL_ROLES);
  }

  @SubscribeMessage('ping')
  handlePing(client: Socket) {
    client.emit('pong', { time: new Date().toISOString() });
  }
}
