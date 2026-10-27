'use client';

import { Check, House, LocateFixed, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useHome } from '@/components/home-context';
import { Page, PageHeader } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card, SectionHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/misc';
import { ConfirmSheet, Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { qk, useApiMutation } from '@/lib/queries';
import type { Home } from '@/lib/types';

export default function SettingsPage() {
  const { home, homes, setHomeId, canManage, isOwner } = useHome();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = useApiMutation(() => api.del(`/homes/${home.id}`), {
    invalidate: [qk.homes],
    success: `${home.name} deleted`,
    onSuccess: () => {
      setDeleting(false);
      const next = homes.find((h) => h.id !== home.id);
      if (next) setHomeId(next.id);
    },
  });

  return (
    <Page>
      <PageHeader title="Home settings" back="/profile" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Re-mount the form when switching homes so fields reset. */}
        <HomeForm key={home.id} home={home} editable={canManage} />

        <section>
          <SectionHeader
            title="Your homes"
            action={
              <Button
                size="sm"
                variant="outline"
                icon={<Plus className="size-4" />}
                onClick={() => setCreating(true)}
              >
                New home
              </Button>
            }
          />
          <div className="space-y-3">
            {homes.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHomeId(h.id)}
                className="flex w-full items-center gap-4 rounded-card bg-surface p-4 text-left shadow-card"
              >
                <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                  <House className="size-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{h.name}</p>
                  <p className="truncate text-muted text-sm">{h.timezone}</p>
                </div>
                <Badge tone={h.role === 'member' ? 'muted' : 'brand'}>{titleCase(h.role)}</Badge>
                {h.id === home.id && (
                  <Check className="size-5 shrink-0 text-brand-600" aria-label="Current home" />
                )}
              </button>
            ))}
          </div>
          {isOwner && (
            <Button
              variant="soft"
              className="mt-6 w-full text-danger"
              icon={<Trash2 className="size-4" />}
              disabled={homes.length < 2}
              onClick={() => setDeleting(true)}
            >
              Delete {home.name}
            </Button>
          )}
          {isOwner && homes.length < 2 && (
            <p className="mt-2 text-center text-muted text-xs">
              Create another home before deleting your only one.
            </p>
          )}
        </section>
      </div>

      <NewHomeSheet open={creating} onClose={() => setCreating(false)} />
      <ConfirmSheet
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate(undefined)}
        loading={remove.isPending}
        title={`Delete ${home.name}?`}
        message="All rooms, devices, boards, scenes, automations and history in this home are deleted for everyone. This can't be undone."
        confirmLabel="Delete home"
      />
    </Page>
  );
}

function HomeForm({ home, editable }: { home: Home; editable: boolean }) {
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const [f, setF] = useState({
    name: home.name,
    timezone: home.timezone,
    latitude: home.latitude?.toString() ?? '',
    longitude: home.longitude?.toString() ?? '',
    tariffPerKwh: String(home.tariffPerKwh),
    currency: home.currency,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const save = useApiMutation(
    () =>
      api.patch(`/homes/${home.id}`, {
        name: f.name.trim(),
        timezone: f.timezone,
        latitude: num(f.latitude),
        longitude: num(f.longitude),
        tariffPerKwh: Number(f.tariffPerKwh) || 0,
        currency: f.currency.trim().toUpperCase(),
      }),
    { invalidate: [qk.homes, qk.energy(home.id, 'month')], success: 'Settings saved' },
  );

  function locate() {
    if (!navigator.geolocation) return toast.error('Location is not available in this browser');
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setF((s) => ({
          ...s,
          // ~1 km precision is plenty for sunrise/sunset and avoids storing an exact address.
          latitude: p.coords.latitude.toFixed(2),
          longitude: p.coords.longitude.toFixed(2),
        })),
      () => toast.error('Could not get your location'),
    );
  }

  return (
    <Card>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <fieldset disabled={!editable} className="space-y-5">
          <Field label="Home name">
            <Input required maxLength={80} value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Time zone" hint="Schedules and energy days follow this time zone.">
            <Select value={f.timezone} onChange={set('timezone')}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <Input
                  type="number"
                  step="0.01"
                  min={-90}
                  max={90}
                  inputMode="decimal"
                  value={f.latitude}
                  onChange={set('latitude')}
                />
              </Field>
              <Field label="Longitude">
                <Input
                  type="number"
                  step="0.01"
                  min={-180}
                  max={180}
                  inputMode="decimal"
                  value={f.longitude}
                  onChange={set('longitude')}
                />
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted text-xs">Used only for sunrise and sunset schedules.</p>
              <Button size="sm" variant="ghost" icon={<LocateFixed className="size-4" />} onClick={locate}>
                Use my location
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
            <Field label="Electricity price per kWh">
              <Input
                type="number"
                step="0.01"
                min={0}
                max={1000}
                inputMode="decimal"
                value={f.tariffPerKwh}
                onChange={set('tariffPerKwh')}
              />
            </Field>
            <Field label="Currency">
              <Input maxLength={3} value={f.currency} onChange={set('currency')} className="uppercase" />
            </Field>
          </div>
        </fieldset>
        {editable ? (
          <Button type="submit" size="lg" className="w-full" loading={save.isPending}>
            Save
          </Button>
        ) : (
          <p className="text-muted text-sm">Only owners and admins can change home settings.</p>
        )}
      </form>
    </Card>
  );
}

function NewHomeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setHomeId } = useHome();
  const [name, setName] = useState('');
  const create = useApiMutation(
    () =>
      api.post<{ home: Home }>('/homes', {
        name: name.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    {
      invalidate: [qk.homes],
      success: 'Home created',
      onSuccess: (r) => {
        setName('');
        onClose();
        setHomeId(r.home.id);
      },
    },
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New home"
      footer={
        <Button
          className="w-full"
          size="lg"
          loading={create.isPending}
          disabled={!name.trim()}
          onClick={() => create.mutate(undefined)}
        >
          Create home
        </Button>
      }
    >
      <Field label="Name">
        <Input
          maxLength={80}
          placeholder="e.g. Beach house"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
