'use client';

import { Bell, CheckCheck, Settings2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Page, PageHeader, QueryState } from '@/components/layout/page';
import { Button, IconLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { qk, useApiMutation, useNotifications } from '@/lib/queries';
import type { AppNotification } from '@/lib/types';

export default function NotificationsPage() {
  const router = useRouter();
  const notes = useNotifications();
  const markRead = useApiMutation((ids?: string[]) => api.post('/notifications/read', ids ? { ids } : {}), {
    invalidate: [qk.notifications],
  });
  const list = notes.data?.notifications ?? [];

  function open(n: AppNotification) {
    if (!n.readAt) markRead.mutate([n.id]);
    if (n.deviceId) router.push(`/devices/${n.deviceId}`);
  }

  return (
    <Page>
      <PageHeader
        title="Notifications"
        back="/"
        actions={
          <IconLink href="/account#notifications" label="Notification settings">
            <Settings2 className="size-5" />
          </IconLink>
        }
      />
      <div className="mx-auto max-w-3xl">
        {(notes.data?.unreadCount ?? 0) > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mb-3 ml-auto flex"
            icon={<CheckCheck className="size-4" />}
            loading={markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            Mark all read
          </Button>
        )}
        <QueryState loading={notes.isPending} error={notes.error}>
          {list.length ? (
            <ul className="space-y-3">
              {list.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className="flex w-full items-start gap-4 rounded-card bg-surface p-4 text-left shadow-card transition hover:shadow-float"
                  >
                    <div className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                      <Bell className="size-5" />
                      {!n.readAt && (
                        <span className="absolute top-1 right-1 size-2.5 rounded-full bg-danger ring-2 ring-surface" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={n.readAt ? 'truncate font-medium' : 'truncate font-bold'}>{n.title}</p>
                        <span className="shrink-0 text-muted text-xs">{timeAgo(n.createdAt)}</span>
                      </div>
                      {n.body && <p className="line-clamp-2 text-muted text-sm">{n.body}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Bell className="size-8" />} title="All quiet">
              Doorbell rings, motion, boards going offline and automation alerts show up here.
            </EmptyState>
          )}
        </QueryState>
      </div>
    </Page>
  );
}
