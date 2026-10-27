'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Cpu, KeyRound, Loader, Wifi } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Radar } from '@/components/devices/radar';
import { useHome } from '@/components/home-context';
import { Page, PageHeader } from '@/components/layout/page';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, Hero } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy';
import { Field, Input, Select } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { qk, useApiMutation, useControllers, useDevices, useRooms } from '@/lib/queries';
import type { Controller } from '@/lib/types';

type Created = { controller: Controller; credentials: { keyId: string; secret: string } };

export default function AddDevicePage() {
  const { home, canManage } = useHome();
  const [created, setCreated] = useState<Created | null>(null);
  const [step, setStep] = useState<'name' | 'credentials' | 'scan'>('name');

  if (!canManage)
    return (
      <Page>
        <PageHeader title="Add Device" back="/devices" />
        <EmptyState icon={<Cpu className="size-8" />} title="Ask an admin">
          Only owners and admins of {home.name} can add boards.
        </EmptyState>
      </Page>
    );

  return (
    <Page>
      <PageHeader title="Add Device" back="/devices" />
      {step === 'name' && (
        <NameStep
          onCreated={(c) => {
            setCreated(c);
            setStep('credentials');
          }}
        />
      )}
      {step === 'credentials' && created && (
        <CredentialsStep created={created} onNext={() => setStep('scan')} />
      )}
      {step === 'scan' && created && <ScanStep controllerId={created.controller.id} />}
    </Page>
  );
}

function NameStep({ onCreated }: { onCreated: (c: Created) => void }) {
  const { home } = useHome();
  const [name, setName] = useState('');
  const create = useApiMutation(
    (n: string) => api.post<Created>(`/homes/${home.id}/controllers`, { name: n }),
    {
      invalidate: [qk.controllers(home.id)],
      onSuccess: onCreated,
    },
  );
  return (
    <div className="mx-auto max-w-xl">
      <Hero
        icon={<Wifi className="size-7" />}
        title="Power on your Voltix board"
        subtitle="It joins your Wi-Fi and connects to this home"
      />
      <Card className="mt-6">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(name.trim());
          }}
        >
          <Field label="Board name" hint="Where is it installed? You'll name each light and fan on it later.">
            <Input
              autoFocus
              placeholder="Living room switchboard"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={create.isPending}
            disabled={!name.trim()}
          >
            Continue
          </Button>
        </form>
      </Card>
    </div>
  );
}

function CredentialsStep({ created, onNext }: { created: Created; onNext: () => void }) {
  const [server, setServer] = useState('');
  useEffect(() => setServer(window.location.host), []);
  const steps = [
    'Power the board. A new board opens its setup Wi-Fi automatically (hold BOOT for 5 s to reset an old one).',
    'On your phone, join the Wi-Fi network named "Voltix-Setup-…".',
    'In the page that opens, pick your home Wi-Fi and paste the server, key and secret below.',
  ];
  return (
    <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
      <Card>
        <div className="flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-500">
            <KeyRound className="size-6" />
          </div>
          <div>
            <h2 className="font-bold text-xl">{created.controller.name}</h2>
            <p className="text-muted text-sm">Board credentials</p>
          </div>
        </div>
        <div className="mt-5 space-y-4">
          <CopyField label="Server" value={server} />
          <CopyField label="Board key" value={created.credentials.keyId} />
          <CopyField label="Board secret" value={created.credentials.secret} secret />
        </div>
        <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-amber-800 text-sm">
          The secret is shown only once. If you lose it, create a new one from Boards.
        </p>
      </Card>
      <Card>
        <h2 className="font-bold text-xl">Connect it</h2>
        <ol className="mt-4 space-y-4">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-gradient font-bold text-sm text-white">
                {i + 1}
              </span>
              <span className="pt-0.5 text-ink-soft">{s}</span>
            </li>
          ))}
        </ol>
        <Button size="lg" className="mt-6 w-full" onClick={onNext}>
          Find my board
        </Button>
        <p className="mt-3 text-center text-muted text-sm">
          Writing your own firmware? Generate the code in{' '}
          <a href="/templates" target="_blank" className="font-medium text-brand-600" rel="noopener">
            Device templates
          </a>
          .
        </p>
      </Card>
    </div>
  );
}

function ScanStep({ controllerId }: { controllerId: string }) {
  const { home } = useHome();
  const router = useRouter();
  const qc = useQueryClient();
  // Realtime events update both lists; polling is the fallback if the socket is down.
  const controllers = useControllers(home.id);
  const devices = useDevices(home.id);
  const rooms = useRooms(home.id);
  const board = controllers.data?.find((c) => c.id === controllerId);
  const found = (devices.data ?? [])
    .filter((d) => d.controllerId === controllerId)
    .sort((a, b) => (a.channel ?? 0) - (b.channel ?? 0));
  const online = !!board?.online;

  useEffect(() => {
    if (online && found.length) return;
    const t = setInterval(() => {
      void qc.invalidateQueries({ queryKey: qk.controllers(home.id) });
      void qc.invalidateQueries({ queryKey: qk.devices(home.id) });
    }, 4000);
    return () => clearInterval(t);
  }, [online, found.length, qc, home.id]);

  const [edits, setEdits] = useState<Record<string, { name?: string; roomId?: string }>>({});
  const [saving, setSaving] = useState(false);

  async function finish() {
    setSaving(true);
    const changes = Object.entries(edits).filter(([, v]) => v.name?.trim() || v.roomId !== undefined);
    const results = await Promise.allSettled(
      changes.map(([id, v]) =>
        api.patch(`/devices/${id}`, {
          ...(v.name?.trim() && { name: v.name.trim() }),
          ...(v.roomId !== undefined && { roomId: v.roomId || null }),
        }),
      ),
    );
    setSaving(false);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) toast.error(errorMessage((failed as PromiseRejectedResult).reason));
    await qc.invalidateQueries({ queryKey: qk.devices(home.id) });
    await qc.invalidateQueries({ queryKey: qk.rooms(home.id) });
    if (!failed) {
      toast.success(`${found.length} device${found.length === 1 ? '' : 's'} added`);
      router.push('/devices');
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Hero
        icon={<Wifi className="size-7" />}
        title={online ? 'Board connected' : 'Waiting for your board'}
        subtitle={
          online
            ? `${board?.name} · ${found.length} device${found.length === 1 ? '' : 's'} found`
            : 'Keep this page open'
        }
      />
      <div className="-mx-4 mt-6 bg-gradient-to-b from-brand-100/50 to-transparent px-4 py-6 sm:rounded-card">
        <Radar
          scanning={!online || !found.length}
          found={found.map((d) => ({ id: d.id, name: d.name, icon: d.icon }))}
        />
      </div>

      {!online || !found.length ? (
        <div className="mx-auto mt-4 flex h-14 max-w-xl items-center justify-center gap-3 rounded-full border-2 border-brand-400 font-medium text-brand-600 text-xl">
          <Loader className="size-5 animate-spin motion-reduce:animate-none" /> Scanning
        </div>
      ) : (
        <Card className="mt-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-6 text-success" />
            <h2 className="font-bold text-xl">Name your devices</h2>
          </div>
          <div className="mt-4 divide-y divide-line">
            {found.map((d) => (
              <div key={d.id} className="grid gap-3 py-4 sm:grid-cols-[3rem_1fr_1fr] sm:items-end">
                <span className="hidden size-12 place-items-center rounded-2xl bg-brand-50 font-bold text-brand-600 sm:grid">
                  {d.channel}
                </span>
                <Field label={`Channel ${d.channel} · ${d.type}`}>
                  <Input
                    placeholder={d.name}
                    maxLength={60}
                    value={edits[d.id]?.name ?? ''}
                    onChange={(e) =>
                      setEdits((s) => ({ ...s, [d.id]: { ...s[d.id], name: e.target.value } }))
                    }
                  />
                </Field>
                <Field label="Room">
                  <Select
                    value={edits[d.id]?.roomId ?? d.roomId ?? ''}
                    onChange={(e) =>
                      setEdits((s) => ({ ...s, [d.id]: { ...s[d.id], roomId: e.target.value } }))
                    }
                  >
                    <option value="">No room</option>
                    {rooms.data?.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row-reverse">
            <Button size="lg" className="sm:flex-1" loading={saving} onClick={finish}>
              Done
            </Button>
            <ButtonLink href="/rooms" variant="soft" size="lg" className="sm:flex-1">
              Create a room first
            </ButtonLink>
          </div>
        </Card>
      )}
    </div>
  );
}
