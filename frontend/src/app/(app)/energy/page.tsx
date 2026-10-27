'use client';

import { Settings2, Zap } from 'lucide-react';
import { useState } from 'react';
import { BarChart } from '@/components/charts';
import { useHome } from '@/components/home-context';
import { Icon } from '@/components/icon';
import { Page, PageHeader } from '@/components/layout/page';
import { IconLink } from '@/components/ui/button';
import { Card, ListRow, SectionHeader } from '@/components/ui/card';
import { Segmented } from '@/components/ui/chips';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { kwh, money } from '@/lib/format';
import { useEnergy } from '@/lib/queries';

type Range = 'week' | 'month' | 'year';

const rangeCopy: Record<Range, { title: string; prev: string }> = {
  week: { title: 'Weekly Analysis', prev: 'last week' },
  month: { title: 'Monthly Analysis', prev: 'last month' },
  year: { title: 'Yearly Analysis', prev: 'last year' },
};

function periodLabel(period: string, range: Range): { label: string; title: string } {
  const d = new Date(`${period.length === 7 ? `${period}-01` : period}T12:00:00`);
  if (range === 'year')
    return {
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      title: d.toLocaleDateString(undefined, { month: 'short' }),
    };
  if (range === 'week')
    return {
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      title: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
    };
  return {
    label: String(d.getDate()),
    title: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  };
}

function usageTier(share: number) {
  if (share >= 0.35) return 'High consumption';
  if (share >= 0.12) return 'Moderate consumption';
  return 'Efficient consumption';
}

export default function EnergyPage() {
  const { home, canManage } = useHome();
  const [range, setRange] = useState<Range>('month');
  const allowed = canManage || home.memberPermissions.energy;
  const energy = useEnergy(home.id, range, allowed);
  const e = energy.data;

  if (!allowed)
    return (
      <Page>
        <PageHeader title="Energy" back="/" />
        <EmptyState icon={<Zap className="size-8" />} title="Energy reports are private">
          The owner of {home.name} has limited energy reports to owners and admins.
        </EmptyState>
      </Page>
    );

  return (
    <Page>
      <PageHeader
        title={rangeCopy[range].title}
        back="/"
        actions={
          canManage && (
            <IconLink href="/settings" label="Tariff settings">
              <Settings2 className="size-5" />
            </IconLink>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-2xl">Energy Consumption</h2>
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: 'week', label: 'Weekly' },
                { value: 'month', label: 'Monthly' },
                { value: 'year', label: 'Yearly' },
              ]}
            />
          </div>
          {energy.isPending || !e ? (
            <Skeleton className="mt-6 h-72" />
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-medium text-5xl text-brand-600 tracking-tight">{kwh(e.totalKwh)}</span>
                <span className="font-medium text-2xl text-brand-600">kWh</span>
                <Zap className="size-7 fill-amber-300 text-amber-400" />
                <span className="ml-auto rounded-full bg-tint px-4 py-1.5 font-semibold text-ink-soft text-sm">
                  ≈ {money(e.cost, e.currency)}
                </span>
              </div>
              <p className="mt-1 text-muted text-sm">
                {e.changePct == null
                  ? 'Not enough history to compare yet.'
                  : `${Math.abs(e.changePct)}% ${e.changePct >= 0 ? 'higher' : 'lower'} than ${rangeCopy[range].prev}.`}
              </p>
              <BarChart
                className="mt-10"
                unit="kWh"
                data={e.series.map((s) => ({ ...periodLabel(s.period, range), value: s.kwh }))}
              />
            </>
          )}
        </Card>

        <section>
          <SectionHeader
            title="Device Energy Usage"
            action={
              e && (
                <span className="font-medium text-brand-500">
                  {e.devices.length} {e.devices.length === 1 ? 'device' : 'devices'}
                </span>
              )
            }
          />
          {energy.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : e?.devices.length ? (
            <div className="space-y-3">
              {e.devices.map((d) => (
                <ListRow
                  key={d.id}
                  href={`/devices/${d.id}`}
                  icon={<Icon name={d.icon} className="size-6" />}
                  title={d.name}
                  subtitle={usageTier(e.totalKwh ? d.kwh / e.totalKwh : 0)}
                  trailing={<span className="shrink-0 font-medium text-muted text-xl">{kwh(d.kwh)} kWh</span>}
                />
              ))}
            </div>
          ) : (
            <EmptyState icon={<Zap className="size-8" />} title="No usage yet">
              Energy is estimated while devices are on, using each device's rated power. Set it in device
              settings for better numbers.
            </EmptyState>
          )}
          <p className="mt-4 text-muted text-xs">
            Estimates use on-time × rated watts × level. Devices with an energy meter report measured values.
            Tariff: {money(home.tariffPerKwh, home.currency)}/kWh.
          </p>
        </section>
      </div>
    </Page>
  );
}
