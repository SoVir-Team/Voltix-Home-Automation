'use client';

import { builtinTemplateMap } from '@voltix/protocol';
import { Settings2, Star, WifiOff, Zap } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { LineChart } from '@/components/charts';
import { ActivityList } from '@/components/devices/activity-list';
import { DeviceControls } from '@/components/devices/controls';
import { DeviceSettingsSheet } from '@/components/devices/device-settings';
import { ScheduleCard } from '@/components/devices/schedule-card';
import { useHome } from '@/components/home-context';
import { Page, PageHeader } from '@/components/layout/page';
import { IconButton } from '@/components/ui/button';
import { Card, ListRow } from '@/components/ui/card';
import { Segmented } from '@/components/ui/chips';
import { Skeleton } from '@/components/ui/misc';
import { hasCap, kwh, timeAgo } from '@/lib/format';
import { useActivity, useDevice, useEnergy, useHistory, useRooms } from '@/lib/queries';
import type { Device } from '@/lib/types';

const metricsFor = (d: Device) => [
  ...(hasCap(d, 'temperatureSensor') ? [{ key: 'temperature', label: 'Temperature', unit: '°C' }] : []),
  ...(hasCap(d, 'temperatureSensor') && typeof d.state.humidity === 'number'
    ? [{ key: 'humidity', label: 'Humidity', unit: '%' }]
    : []),
  ...(hasCap(d, 'airQuality')
    ? [
        { key: 'pm25', label: 'PM2.5', unit: 'µg/m³' },
        { key: 'pm10', label: 'PM10', unit: 'µg/m³' },
      ]
    : []),
  ...(hasCap(d, 'powerSensor')
    ? [
        { key: 'power', label: 'Power', unit: 'W' },
        { key: 'voltage', label: 'Voltage', unit: 'V' },
      ]
    : []),
];

export default function DevicePage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { home, canManage } = useHome();
  const device = useDevice(deviceId);
  const rooms = useRooms(home.id);
  const activity = useActivity(home.id, deviceId);
  const energy = useEnergy(home.id, 'month', canManage || home.memberPermissions.energy);
  const [settings, setSettings] = useState(false);

  if (device.isPending)
    return (
      <Page>
        <Skeleton className="mt-20 h-96" />
      </Page>
    );
  if (device.isError || !device.data)
    return (
      <Page>
        <PageHeader title="Device not found" back="/devices" />
      </Page>
    );

  const d = device.data;
  const room = rooms.data?.find((r) => r.id === d.roomId);
  const offline = !!d.controllerId && !d.online;
  const usage = energy.data?.devices.find((x) => x.id === d.id);
  const metrics = metricsFor(d);

  return (
    <Page>
      <PageHeader
        title={d.name}
        subtitle={room?.name ?? builtinTemplateMap.get(d.type)?.name ?? d.type}
        back="/devices"
        actions={
          <IconButton label="Device settings" onClick={() => setSettings(true)}>
            {d.favorite ? (
              <Star className="size-5 fill-brand-400 text-brand-500" />
            ) : (
              <Settings2 className="size-5" />
            )}
          </IconButton>
        }
      />

      {offline && (
        <div className="mb-4 flex items-center gap-3 rounded-[1.5rem] bg-amber-50 px-5 py-4 text-warning">
          <WifiOff className="size-5 shrink-0" />
          <p className="text-sm">
            <strong>Offline</strong> · last seen {timeAgo(d.stateUpdatedAt)}. Controls come back when the
            board reconnects.
          </p>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-6">
        <div className="space-y-4">
          <DeviceControls device={d} />
          {metrics.length > 0 && <HistoryCard device={d} metrics={metrics} timezone={home.timezone} />}
        </div>
        <div className="space-y-4">
          {hasCap(d, 'powerState') && <ScheduleCard device={d} />}
          {usage && (
            <ListRow
              icon={<Zap className="size-6" />}
              title="Energy this month"
              subtitle="Estimated from on-time and rated power"
              trailing={<span className="font-medium text-muted text-xl">{kwh(usage.kwh)} kWh</span>}
            />
          )}
          <section>
            <h2 className="mb-3 font-bold text-xl">History</h2>
            <ActivityList events={activity.data?.slice(0, 12)} loading={activity.isPending} highlightFirst />
          </section>
        </div>
      </div>

      <DeviceSettingsSheet
        key={`${d.id}-${d.name}-${d.roomId}`}
        device={d}
        open={settings}
        onClose={() => setSettings(false)}
      />
    </Page>
  );
}

function HistoryCard({
  device,
  metrics,
  timezone,
}: {
  device: Device;
  metrics: { key: string; label: string; unit: string }[];
  timezone: string;
}) {
  const [metric, setMetric] = useState(metrics[0]!.key);
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
  const history = useHistory(device.id, metric, range);
  const m = metrics.find((x) => x.key === metric) ?? metrics[0]!;
  const fmt = (t: number) =>
    new Date(t).toLocaleString(undefined, {
      timeZone: timezone,
      ...(range === '24h' ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' }),
    });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold text-xl">{m.label}</h2>
        <Segmented
          value={range}
          onChange={setRange}
          options={[
            { value: '24h', label: '24h' },
            { value: '7d', label: '7 days' },
            { value: '30d', label: '30 days' },
          ]}
        />
      </div>
      {metrics.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {metrics.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setMetric(x.key)}
              className={`h-9 rounded-full px-4 font-semibold text-sm ${x.key === metric ? 'bg-brand-50 text-brand-700 ring-2 ring-brand-300' : 'bg-tint text-muted'}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      {history.isPending ? (
        <Skeleton className="h-56" />
      ) : (
        <LineChart points={history.data ?? []} unit={m.unit} formatX={fmt} />
      )}
    </Card>
  );
}
