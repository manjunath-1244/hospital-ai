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
    this.emitTo('patient.deleted', p, [
      'DOCTOR',
      'NURSE',
      'RECEPTIONIST',
      'ADMIN',
      'PHARMACIST',
      'CARE_COORDINATOR',
      'RADIOLOGIST',
    ]);
  }

  @SubscribeMessage('ping')
  handlePing(client: Socket) {
    client.emit('pong', { time: new Date().toISOString() });
  }
}
