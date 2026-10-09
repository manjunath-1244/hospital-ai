'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserCog } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { Specialist } from '../../lib/specialists';
import { ErrorBox, Loading } from '../ui/common';
import { Badge, Button, Card, EmptyState, SectionTitle } from '../ui/kit';

/** Admin card: list specialists and flip their availability. */
export const SpecialistsCard: React.FC = () => {
  const [list, setList] = useState<Specialist[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await apiFetch<Specialist[]>('/hospital/specialists'));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggle = async (s: Specialist) => {
    setBusyId(s.id);
    try {
      await apiFetch(`/hospital/specialists/${encodeURIComponent(s.id)}/availability`, { method: 'PATCH', body: { isAvailable: !s.isAvailable } });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId('');
    }
  };

  return (
    <Card data-testid="specialists-card">
      <SectionTitle icon={<UserCog className="h-5 w-5" />} hint="Switch a specialist's availability for new bookings.">
        Specialists
      </SectionTitle>
      {!list && !error && <Loading text="Loading specialists..." />}
      <ErrorBox message={error} />
      {list && list.length === 0 && <EmptyState title="No specialists." hint="Specialists appear here once their accounts exist." />}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {list?.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{s.name}</p>
              <p className="text-sm text-ink-3">{s.specialty ?? '—'}{s.department ? ` • ${s.department}` : ''}</p>
              <div className="mt-1.5">
                <Badge tone={s.isAvailable ? 'success' : 'neutral'}>{s.isAvailable ? 'Accepting bookings' : 'Not accepting bookings'}</Badge>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={busyId === s.id}
              onClick={() => toggle(s)}
              aria-pressed={s.isAvailable}
              data-testid={`specialist-toggle-${s.id}`}
            >
              {s.isAvailable ? 'Available' : 'Unavailable'}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
};
