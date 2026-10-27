'use client';

import { CalendarClock, Play, Plus, Timer, Workflow } from 'lucide-react';
import { useState } from 'react';
import { AutomationSheet } from '@/components/automation/automation-sheet';
import { useHome } from '@/components/home-context';
import { Page, PageHeader, QueryState } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/chips';
import { EmptyState } from '@/components/ui/misc';
import { Toggle } from '@/components/ui/toggle';
import { api } from '@/lib/api';
import { type AutomationTab, describeTrigger, sortAutomations, tabOf } from '@/lib/automation';
import { timeAgo } from '@/lib/format';
import { qk, useApiMutation, useAutomations, useDevices } from '@/lib/queries';
import type { Automation } from '@/lib/types';

const tabs: Record<AutomationTab, { label: string; icon: typeof Timer; empty: string }> = {
  schedules: {
    label: 'Schedules',
    icon: CalendarClock,
    empty: 'Run devices at set times, at sunrise or sunset, or during a daily window.',
  },
  timers: {
    label: 'Timers',
    icon: Timer,
    empty: 'Do something once, later — "turn off the geyser in 30 minutes".',
  },
  rules: {
    label: 'Automations',
    icon: Workflow,
    empty: 'React to your home — "when motion is detected after sunset, turn on the porch light".',
  },
};

export default function AutomationsPage() {
  const { home, canManage } = useHome();
  const autos = useAutomations(home.id);
  const devices = useDevices(home.id);
  const [tab, setTab] = useState<AutomationTab>('schedules');
  const [editing, setEditing] = useState<Automation | 'new' | null>(null);
  const list = sortAutomations((autos.data ?? []).filter((a) => tabOf(a.trigger) === tab));
  const T = tabs[tab];

  const toggle = useApiMutation(
    (a: { id: string; enabled: boolean }) => api.patch(`/automations/${a.id}`, { enabled: a.enabled }),
    { invalidate: [qk.automations(home.id)] },
  );
  const run = useApiMutation((a: Automation) => api.post(`/automations/${a.id}/run`), {
    success: 'Running now',
  });

  return (
    <Page>
      <PageHeader
        title="Automations"
        back="/"
        actions={
          canManage && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              New
            </Button>
          )
        }
      />
      <Segmented
        className="mb-5 w-full sm:w-auto"
        value={tab}
        onChange={setTab}
        options={(Object.keys(tabs) as AutomationTab[]).map((k) => ({ value: k, label: tabs[k].label }))}
      />
      <QueryState loading={autos.isPending || devices.isPending} error={autos.error}>
        {list.length ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {list.map((a) => (
              <Card key={a.id} className="flex items-center gap-4 py-4">
                <button
                  type="button"
                  disabled={!canManage}
                  onClick={() => setEditing(a)}
                  className="flex min-w-0 flex-1 items-center gap-4 text-left"
                >
                  <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                    <T.icon className="size-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-bold">{a.name}</p>
                    <p className="truncate text-muted text-sm">
                      {describeTrigger(a.trigger, devices.data ?? [])}
                    </p>
                    {a.enabled && a.nextRunAt && (
                      <p className="truncate text-brand-600 text-xs">Next {timeAgo(a.nextRunAt)}</p>
                    )}
                  </div>
                </button>
                {canManage && (
                  <button
                    type="button"
                    aria-label={`Run ${a.name} now`}
                    onClick={() => run.mutate(a)}
                    className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-brand-600"
                  >
                    <Play className="size-4" />
                  </button>
                )}
                <Toggle
                  label={`${a.name} enabled`}
                  checked={a.enabled}
                  disabled={!canManage}
                  onChange={(enabled) => toggle.mutate({ id: a.id, enabled })}
                />
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<T.icon className="size-8" />}
            title={`No ${T.label.toLowerCase()} yet`}
            action={
              canManage && (
                <Button icon={<Plus className="size-5" />} onClick={() => setEditing('new')}>
                  Create one
                </Button>
              )
            }
          >
            {T.empty}
          </EmptyState>
        )}
      </QueryState>
      {editing && (
        <AutomationSheet
          key={editing === 'new' ? `new-${tab}` : editing.id}
          existing={editing === 'new' ? undefined : editing}
          tab={editing === 'new' ? tab : tabOf(editing.trigger)}
          devices={devices.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  );
}
