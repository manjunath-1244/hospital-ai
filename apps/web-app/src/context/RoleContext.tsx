'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../lib/api';
import { useAuth } from './AuthContext';
import type { BackendRole } from '../lib/types';

export type UserRole =
  | 'RECEPTIONIST'
  | 'ED_NURSE'
  | 'DOCTOR'
  | 'RADIOLOGIST'
  | 'PHARMACIST'
  | 'CARE_COORDINATOR'
  | 'ADMIN';

export const toPortalRole = (r: BackendRole): UserRole => (r === 'NURSE' ? 'ED_NURSE' : r);

export interface AlertNotification {
  id: string;
  type: 'INFO' | 'UNCONSULTED' | 'CRITICAL_LAB' | 'NEWS2' | 'DICOM';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export type RealtimeEvent = 'patient.registered' | 'patient.closed' | 'patient.reopened' | 'patient.deleted' | 'doctor.consulted' | 'dicom.uploaded' | 'alert.critical_lab' | 'alert.news2_deterioration';

interface RoleContextType {
  /** Portal currently displayed (own role, or the admin's "view as" selection). */
  role: UserRole;
  /** The logged-in user's own portal role. */
  ownRole: UserRole | null;
  viewAs: UserRole | null;
  setViewAs: (role: UserRole) => void;
  socketConnected: boolean;
  alerts: AlertNotification[];
  dismissAlert: (id: string) => void;
  unconsultedCount: number;
  news2AlertCount: number;
  subscribe: (event: RealtimeEvent, cb: (payload: unknown) => void) => () => void;
}

const RoleContext = createContext<RoleContextType | undefined>(undefined);

/* eslint-disable @typescript-eslint/no-explicit-any */
export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, user } = useAuth();
  const ownRole = user ? toPortalRole(user.role) : null;
  const [viewAsState, setViewAsState] = useState<UserRole | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const listeners = useRef(new Map<RealtimeEvent, Set<(p: unknown) => void>>());

  const role: UserRole = ownRole === 'ADMIN' ? (viewAsState ?? 'ADMIN') : (ownRole ?? 'DOCTOR');

  const subscribe = useCallback((event: RealtimeEvent, cb: (payload: unknown) => void) => {
    let set = listeners.current.get(event);
    if (!set) {
      set = new Set();
      listeners.current.set(event, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket = io(API_URL, { auth: { token }, transports: ['websocket', 'polling'] });

    const push = (type: AlertNotification['type'], title: string, message: string) =>
      setAlerts((prev) =>
        [{ id: crypto.randomUUID(), type, title, message, timestamp: new Date().toLocaleTimeString(), read: false }, ...prev].slice(0, 50),
      );
    const emitLocal = (event: RealtimeEvent, payload: unknown) =>
      listeners.current.get(event)?.forEach((cb) => cb(payload));

    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('connect_error', () => setSocketConnected(false));

    socket.on('patient.registered', (d: any) => {
      push('INFO', 'New OP Registration', `Patient ${d.name ?? d.patientId} registered at the front desk.`);
      emitLocal('patient.registered', d);
    });
    socket.on('patient.closed', (d: any) => {
      push('INFO', 'Session Closed', `${d.patientName ?? d.patientId} was closed${d.closedBy ? ` by ${d.closedBy}` : ''}.`);
      emitLocal('patient.closed', d);
    });
    socket.on('patient.reopened', (d: any) => emitLocal('patient.reopened', d));
    socket.on('patient.deleted', (d: any) => emitLocal('patient.deleted', d));
    socket.on('doctor.consulted', (d: any) => {
      push('INFO', 'Consultation Recorded', `${d.doctorName ?? 'Doctor'} consulted ${d.patientName ?? d.patientId}${d.diagnosis ? ` — ${d.diagnosis}` : ''}.`);
      emitLocal('doctor.consulted', d);
    });
    socket.on('alert.unconsulted_patient', (d: any) => {
      push('UNCONSULTED', 'Unconsulted Patient Delay', `Patient ${d.name} has been waiting ${d.waitTimeMinutes ?? '?'} min without a consultation.`);
    });
    socket.on('alert.critical_lab', (d: any) => {
      push('CRITICAL_LAB', 'Critical Lab Result', `${d.patientName ?? d.patientId}: ${d.testName} = ${d.value} ${d.unit ?? ''} (${d.severity ?? 'CRITICAL'})`);
      emitLocal('alert.critical_lab', d);
    });
    socket.on('alert.news2_deterioration', (d: any) => {
      push('NEWS2', 'NEWS2 Deterioration', `${d.patientName ?? d.patientId}: NEWS2 ${d.news2Score} (${d.riskLevel})`);
      emitLocal('alert.news2_deterioration', d);
    });
    socket.on('dicom.uploaded', (d: any) => {
      push('DICOM', 'Imaging Study Uploaded', `${d.modality ?? 'Study'} for patient ${d.patientId}${d.description ? `: ${d.description}` : ''}`);
      emitLocal('dicom.uploaded', d);
    });

    return () => {
      socket.disconnect();
      setSocketConnected(false);
      setAlerts([]);
      setViewAsState(null);
    };
  }, [token]);

  const dismissAlert = (id: string) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  const value = useMemo<RoleContextType>(
    () => ({
      role,
      ownRole,
      viewAs: viewAsState,
      setViewAs: setViewAsState,
      socketConnected,
      alerts,
      dismissAlert,
      unconsultedCount: alerts.filter((a) => a.type === 'UNCONSULTED').length,
      news2AlertCount: alerts.filter((a) => a.type === 'NEWS2' || a.type === 'CRITICAL_LAB').length,
      subscribe,
    }),
    [role, ownRole, viewAsState, socketConnected, alerts, subscribe],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};

export const useRole = () => {
  const context = useContext(RoleContext);
  if (!context) throw new Error('useRole must be used within a RoleProvider');
  return context;
};

/** Run `cb` whenever one of the given realtime events arrives. */
export function useRealtime(events: RealtimeEvent[], cb: () => void) {
  const { subscribe } = useRole();
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  const key = events.join('|');
  useEffect(() => {
    const unsubs = key.split('|').map((e) => subscribe(e as RealtimeEvent, () => ref.current()));
    return () => unsubs.forEach((u) => u());
  }, [key, subscribe]);
}
