'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserCheck, UserPlus, Shield, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { BackendRole, UserAccount } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { ErrorBox, SuccessBox, Loading } from '../ui/common';
import { Alert, Badge, Button, Card, Field, Input, SectionTitle, Select, TableFrame, type Tone } from '../ui/kit';

const ALL_ROLES: { id: BackendRole; label: string }[] = [
  { id: 'ADMIN', label: 'Admin' },
  { id: 'DOCTOR', label: 'Doctor' },
  { id: 'NURSE', label: 'Nurse' },
  { id: 'RECEPTIONIST', label: 'Receptionist' },
  { id: 'SPECIALIST', label: 'Specialist' },
  { id: 'RADIOLOGIST', label: 'Radiologist' },
  { id: 'PHARMACIST', label: 'Pharmacist' },
  { id: 'CARE_COORDINATOR', label: 'Care Coordinator' },
];

const roleTone = (role: BackendRole): Tone => {
  switch (role) {
    case 'ADMIN': return 'danger';
    case 'DOCTOR': return 'brand';
    case 'SPECIALIST': return 'brand';
    case 'NURSE': return 'success';
    case 'RECEPTIONIST': return 'warning';
    case 'PHARMACIST': return 'neutral';
    case 'RADIOLOGIST': return 'neutral';
    case 'CARE_COORDINATOR': return 'neutral';
    default: return 'neutral';
  }
};

type ModalState =
  | { kind: 'add' }
  | { kind: 'edit'; user: UserAccount }
  | { kind: 'delete'; user: UserAccount }
  | null;

export const UserManagementPanel: React.FC = () => {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserAccount[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [modal, setModal] = useState<ModalState>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  // Form fields
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<BackendRole>('DOCTOR');
  const [password, setPassword] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [department, setDepartment] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<UserAccount[]>('/admin/users');
      setUsers(data);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setModal({ kind: 'add' });
    setUsername('');
    setDisplayName('');
    setRole('DOCTOR');
    setPassword('');
    setSpecialty('');
    setDepartment('');
    setIsAvailable(true);
    setModalError('');
  };

  const openEdit = (user: UserAccount) => {
    setModal({ kind: 'edit', user });
    setUsername(user.username);
    setDisplayName(user.displayName);
    setRole(user.role);
    setPassword('');
    setSpecialty(user.specialty ?? '');
    setDepartment(user.department ?? '');
    setIsAvailable(user.isAvailable);
    setModalError('');
  };

  const openDelete = (user: UserAccount) => {
    setModal({ kind: 'delete', user });
    setModalError('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    setModalBusy(true);
    setModalError('');
    try {
      if (modal.kind === 'add') {
        const newUser = await apiFetch<UserAccount>('/admin/users', {
          method: 'POST',
          body: {
            username: username.trim(),
            displayName: displayName.trim(),
            role,
            ...(password.trim() ? { password: password.trim() } : {}),
            ...(specialty.trim() ? { specialty: specialty.trim() } : {}),
            ...(department.trim() ? { department: department.trim() } : {}),
            isAvailable,
          },
        });
        setMsg(`Created new ${newUser.role} account: ${newUser.displayName} (@${newUser.username}).`);
      } else if (modal.kind === 'edit') {
        const updated = await apiFetch<UserAccount>(`/admin/users/${encodeURIComponent(modal.user.id)}`, {
          method: 'PUT',
          body: {
            displayName: displayName.trim(),
            role,
            ...(password.trim() ? { password: password.trim() } : {}),
            specialty: specialty.trim() || null,
            department: department.trim() || null,
            isAvailable,
          },
        });
        setMsg(`Updated staff account ${updated.displayName} (@${updated.username}).`);
      } else if (modal.kind === 'delete') {
        await apiFetch<{ success: boolean }>(`/admin/users/${encodeURIComponent(modal.user.id)}`, {
          method: 'DELETE',
        });
        setMsg(`Deleted staff account ${modal.user.displayName} (@${modal.user.username}).`);
      }
      setModal(null);
      await load();
    } catch (err) {
      setModalError(errorMessage(err));
    } finally {
      setModalBusy(false);
    }
  };

  return (
    <Card className="space-y-4">
      <SectionTitle
        icon={<UserCheck className="h-5 w-5" />}
        className="!mb-0"
        actions={
          <Button variant="primary" size="sm" onClick={openAdd} icon={<UserPlus className="h-4 w-4" />}>
            Add New Staff Account
          </Button>
        }
      >
        Staff & Role Management {users && <span className="text-base font-normal text-ink-3">({users.length} accounts)</span>}
      </SectionTitle>

      <SuccessBox message={msg} />
      <ErrorBox message={error} />
      {loading && <Loading text="Loading staff accounts..." />}

      {users && (
        <TableFrame>
          <table data-testid="user-management-table">
            <thead>
              <tr>
                <th scope="col">User / ID</th>
                <th scope="col">Display Name</th>
                <th scope="col">Role</th>
                <th scope="col">Specialty / Department</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = me?.username === u.username || me?.id === u.id;
                return (
                  <tr key={u.id}>
                    <td className="font-mono">
                      <span className="font-semibold text-ink">@{u.username}</span>
                      <span className="block text-xs text-ink-3">{u.id}</span>
                    </td>
                    <td className="font-medium text-ink">
                      {u.displayName} {isSelf && <span className="ml-1 text-xs text-brand-700 font-semibold">(You)</span>}
                    </td>
                    <td>
                      <Badge tone={roleTone(u.role)}>{u.role}</Badge>
                    </td>
                    <td className="text-sm text-ink-2">
                      {u.specialty || u.department ? (
                        <span>{[u.specialty, u.department].filter(Boolean).join(' • ')}</span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td>
                      {u.isAvailable ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-success-700">
                          <CheckCircle className="h-3.5 w-3.5" /> Available
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-700">
                          <XCircle className="h-3.5 w-3.5" /> On Leave / Inactive
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => openEdit(u)} icon={<Edit2 className="h-3.5 w-3.5" />}>
                          Edit
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => openDelete(u)} disabled={isSelf} icon={<Trash2 className="h-3.5 w-3.5" />}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableFrame>
      )}

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
          <div className="w-full max-w-lg space-y-5 rounded-card border border-line bg-surface p-6 shadow-pop">
            <h2 id="user-modal-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
              <Shield className="h-5 w-5 text-brand-700" />
              {modal.kind === 'add' && 'Create New Staff Account'}
              {modal.kind === 'edit' && `Edit Account: @${modal.user.username}`}
              {modal.kind === 'delete' && `Delete Account: ${modal.user.displayName}`}
            </h2>

            {modal.kind === 'delete' ? (
              <form onSubmit={handleSave} className="space-y-4">
                <Alert tone="danger">
                  Are you sure you want to permanently delete account <strong>{modal.user.displayName}</strong> (@{modal.user.username}, Role: {modal.user.role})? This action cannot be undone.
                </Alert>
                <ErrorBox message={modalError} />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setModal(null)} disabled={modalBusy}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="danger" loading={modalBusy}>
                    Confirm Delete
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSave} className="space-y-4">
                {modal.kind === 'add' && (
                  <Field label="Username *">
                    {(id) => (
                      <Input
                        id={id}
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="e.g. jsmith"
                        autoFocus
                      />
                    )}
                  </Field>
                )}

                <Field label="Display Name *">
                  {(id) => (
                    <Input
                      id={id}
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Dr. John Smith"
                    />
                  )}
                </Field>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Role *">
                    {(id) => (
                      <Select id={id} value={role} onChange={(e) => setRole(e.target.value as BackendRole)}>
                        {ALL_ROLES.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field label={modal.kind === 'add' ? 'Password (optional)' : 'Reset Password (optional)'}>
                    {(id) => (
                      <Input
                        id={id}
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={modal.kind === 'add' ? 'Default if empty' : 'Leave empty to keep current'}
                      />
                    )}
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Specialty (for Specialists / Doctors)">
                    {(id) => (
                      <Input
                        id={id}
                        type="text"
                        value={specialty}
                        onChange={(e) => setSpecialty(e.target.value)}
                        placeholder="e.g. Cardiology"
                      />
                    )}
                  </Field>

                  <Field label="Department">
                    {(id) => (
                      <Input
                        id={id}
                        type="text"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        placeholder="e.g. Outpatient Care"
                      />
                    )}
                  </Field>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    id="user-available-check"
                    type="checkbox"
                    checked={isAvailable}
                    onChange={(e) => setIsAvailable(e.target.checked)}
                    className="h-4 w-4 rounded border-line text-brand-700 focus:ring-brand-500"
                  />
                  <label htmlFor="user-available-check" className="text-sm font-medium text-ink">
                    Active & Available for appointments/referrals
                  </label>
                </div>

                <ErrorBox message={modalError} />

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="secondary" onClick={() => setModal(null)} disabled={modalBusy}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" loading={modalBusy}>
                    {modal.kind === 'add' ? 'Create Account' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};
