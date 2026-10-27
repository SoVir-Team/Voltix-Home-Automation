'use client';

import { Cpu, Download, KeyRound, Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useHome } from '@/components/home-context';
import { Page, PageHeader, QueryState } from '@/components/layout/page';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, Hero } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy';
import { Field, Input } from '@/components/ui/field';
import { Badge, EmptyState } from '@/components/ui/misc';
import { ConfirmSheet, Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import {
  type BoardFirmware,
  qk,
  useApiMutation,
  useControllers,
  useFirmware,
  useOtaProgress,
} from '@/lib/queries';
import type { Controller } from '@/lib/types';

export default function BoardsPage() {
  const { home, canManage } = useHome();
  const boards = useControllers(home.id, canManage);
  const firmware = useFirmware(home.id);
  const fw = new Map(firmware.data?.map((f) => [f.controllerId, f]));
  const list = boards.data ?? [];
  const online = list.filter((b) => b.online).length;
  const updates = firmware.data?.filter((f) => f.updateAvailable).length ?? 0;

  if (!canManage)
    return (
      <Page>
        <PageHeader title="Boards" back="/profile" />
        <EmptyState icon={<Cpu className="size-8" />} title="Ask an admin">
          Only owners and admins of {home.name} can manage boards.
        </EmptyState>
      </Page>
    );

  return (
    <Page>
      <PageHeader
        title="Boards"
        back="/profile"
        actions={
          <ButtonLink href="/devices/add" size="sm" icon={<Plus className="size-4" />}>
            Add
          </ButtonLink>
        }
      />
      <Hero
        icon={<Cpu className="size-8" strokeWidth={1.6} />}
        title={`${list.length} board${list.length === 1 ? '' : 's'}`}
        subtitle={`${online} online${updates ? ` · ${updates} firmware update${updates === 1 ? '' : 's'}` : ' · firmware up to date'}`}
      />
      <div className="mt-6">
        <QueryState loading={boards.isPending} error={boards.error}>
          {list.length ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {list.map((b) => (
                <BoardCard key={b.id} board={b} fw={fw.get(b.id)} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Cpu className="size-8" />}
              title="No boards yet"
              action={
                <ButtonLink href="/devices/add" icon={<Plus className="size-5" />}>
                  Add a board
                </ButtonLink>
              }
            >
              A Voltix board drives the lights, fans and sockets wired to it.
            </EmptyState>
          )}
        </QueryState>
      </div>
    </Page>
  );
}

const otaLabel: Record<string, string> = {
  pending: 'Waiting to start',
  offered: 'Update sent',
  downloading: 'Downloading',
  installing: 'Installing',
  succeeded: 'Updated',
  failed: 'Update failed',
  timeout: 'Update timed out',
};

function BoardCard({ board, fw }: { board: Controller; fw?: BoardFirmware }) {
  const { home } = useHome();
  const ota = useOtaProgress(board.id).data;
  const [sheet, setSheet] = useState<'rename' | 'secret' | 'delete' | null>(null);
  const [credentials, setCredentials] = useState<{ keyId: string; secret: string } | null>(null);
  const [name, setName] = useState(board.name);
  const invalidate = [qk.controllers(home.id), qk.firmware(home.id)] as const;

  const update = useApiMutation(() => api.post(`/controllers/${board.id}/update`), {
    invalidate,
    success: `Updating ${board.name} to ${fw?.latest?.version}`,
  });
  const restart = useApiMutation(() => api.post(`/controllers/${board.id}/restart`), {
    success: 'Restarting…',
  });
  const rename = useApiMutation(() => api.patch(`/controllers/${board.id}`, { name: name.trim() }), {
    invalidate,
    onSuccess: () => setSheet(null),
  });
  const regenerate = useApiMutation(
    () =>
      api.post<{ credentials: { keyId: string; secret: string } }>(
        `/controllers/${board.id}/regenerate-secret`,
      ),
    { invalidate, onSuccess: (r) => setCredentials(r.credentials) },
  );
  const remove = useApiMutation(() => api.del(`/controllers/${board.id}`), {
    invalidate: [...invalidate, qk.devices(home.id), qk.rooms(home.id)],
    success: `${board.name} removed`,
    onSuccess: () => setSheet(null),
  });

  const busy = ota && !['succeeded', 'failed', 'timeout'].includes(ota.status);
  const details = [
    ['Firmware', board.firmwareVersion ?? '–'],
    ['Model', board.model ?? '–'],
    ['Devices', String(board.deviceCount ?? 0)],
    ['IP address', board.ip ?? '–'],
    ['MAC', board.mac ?? '–'],
    ['Board key', board.keyId],
  ];

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-500">
          <Cpu className="size-7" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-bold text-lg">{board.name}</h2>
            <button
              type="button"
              aria-label="Rename board"
              onClick={() => setSheet('rename')}
              className="text-muted hover:text-brand-600"
            >
              <Pencil className="size-4" />
            </button>
          </div>
          <p className="flex items-center gap-2 text-muted text-sm">
            <span
              className={board.online ? 'size-2 rounded-full bg-success' : 'size-2 rounded-full bg-subtle'}
            />
            {board.online
              ? 'Online'
              : board.lastSeenAt
                ? `Last seen ${timeAgo(board.lastSeenAt)}`
                : 'Never connected'}
          </p>
        </div>
        {fw?.updateAvailable && !busy && <Badge tone="warning">Update</Badge>}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {details.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted">{k}</dt>
            <dd className="truncate font-medium font-mono text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>

      {ota && (
        <div className="mt-4">
          <div className="flex justify-between text-sm">
            <span className="font-medium">{otaLabel[ota.status] ?? ota.status}</span>
            {busy && <span className="text-muted">{ota.progress}%</span>}
          </div>
          {busy && (
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-tint">
              <div
                className="h-full rounded-full bg-brand-gradient transition-[width]"
                style={{ width: `${ota.progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {fw?.updateAvailable && (
          <Button
            size="sm"
            icon={<Download className="size-4" />}
            loading={update.isPending}
            disabled={!board.online || !!busy}
            onClick={() => update.mutate(undefined)}
          >
            Update to {fw.latest?.version}
          </Button>
        )}
        <Button
          size="sm"
          variant="soft"
          icon={<RotateCw className="size-4" />}
          loading={restart.isPending}
          disabled={!board.online}
          onClick={() => restart.mutate(undefined)}
        >
          Restart
        </Button>
        <Button
          size="sm"
          variant="soft"
          icon={<KeyRound className="size-4" />}
          onClick={() => setSheet('secret')}
        >
          New secret
        </Button>
        <Button
          size="sm"
          variant="soft"
          className="text-danger"
          icon={<Trash2 className="size-4" />}
          onClick={() => setSheet('delete')}
        >
          Remove
        </Button>
      </div>

      <Sheet
        open={sheet === 'rename'}
        onClose={() => setSheet(null)}
        title="Rename board"
        footer={
          <Button
            className="w-full"
            size="lg"
            loading={rename.isPending}
            disabled={!name.trim()}
            onClick={() => rename.mutate(undefined)}
          >
            Save
          </Button>
        }
      >
        <Field label="Board name">
          <Input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </Sheet>

      <Sheet
        open={sheet === 'secret'}
        onClose={() => {
          setSheet(null);
          setCredentials(null);
        }}
        title="New board secret"
        footer={
          !credentials && (
            <Button
              className="w-full"
              size="lg"
              variant="danger"
              loading={regenerate.isPending}
              onClick={() => regenerate.mutate(undefined)}
            >
              Create new secret
            </Button>
          )
        }
      >
        {credentials ? (
          <div className="space-y-4">
            <CopyField label="Board key" value={credentials.keyId} />
            <CopyField label="Board secret" value={credentials.secret} secret />
            <p className="rounded-2xl bg-amber-50 p-3 text-amber-800 text-sm">
              Shown only once. Open the board's setup portal (hold BOOT for 5 s) and enter the new secret.
            </p>
          </div>
        ) : (
          <p className="text-ink-soft">
            The board disconnects right away and stays offline until you enter the new secret in its setup
            portal. Use this if the old secret may have leaked.
          </p>
        )}
      </Sheet>

      <ConfirmSheet
        open={sheet === 'delete'}
        onClose={() => setSheet(null)}
        onConfirm={() => remove.mutate(undefined)}
        loading={remove.isPending}
        title={`Remove ${board.name}?`}
        message={`Its ${board.deviceCount ?? 0} devices, their schedules and history will be deleted. The board disconnects immediately.`}
        confirmLabel="Remove board"
      />
    </Card>
  );
}
