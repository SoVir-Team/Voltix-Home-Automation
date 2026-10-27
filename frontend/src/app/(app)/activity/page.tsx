'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityList } from '@/components/devices/activity-list';
import { useHome } from '@/components/home-context';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { api } from '@/lib/api';
import { qk, useDevices } from '@/lib/queries';
import type { ActivityEvent } from '@/lib/types';

export default function ActivityPage() {
  const { home } = useHome();
  const devices = useDevices(home.id);
  const [deviceId, setDeviceId] = useState('');
  const feed = useInfiniteQuery({
    queryKey: [...qk.activity(home.id, deviceId || undefined), 'feed'],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api.get<{ events: ActivityEvent[]; nextBefore: number | null }>(
        `/homes/${home.id}/activity?limit=50${deviceId ? `&deviceId=${deviceId}` : ''}${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextBefore,
  });
  const events = feed.data?.pages.flatMap((p) => p.events);

  return (
    <Page>
      <PageHeader title="Activity" back="/profile" />
      <div className="mx-auto max-w-3xl">
        <Select
          className="mb-5"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          aria-label="Filter by device"
        >
          <option value="">All devices</option>
          {devices.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <ActivityList events={events} loading={feed.isPending} showDevice={!deviceId} />
        {feed.hasNextPage && (
          <Button
            variant="soft"
            className="mt-5 w-full"
            loading={feed.isFetchingNextPage}
            onClick={() => feed.fetchNextPage()}
          >
            Load older
          </Button>
        )}
      </div>
    </Page>
  );
}
