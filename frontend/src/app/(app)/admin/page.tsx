'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, Rocket, Search, ShieldCheck, ShieldOff, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { useHome } from '@/components/home-context';
import { Page, PageHeader, QueryState } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipTabs } from '@/components/ui/chips';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Badge, EmptyState } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useApiMutation } from '@/lib/queries';
import type { FirmwareRelease, Rollout } from '@/lib/types';

type Tab = 'overview' | 'users' | 'homes' | 'boards' | 'firmware' | 'audit';

export default function AdminPage() {
  const { user } = useHome();
  const [tab, setTab] = useState<Tab>('overview');
  if (!user.isPlatformAdmin)
    return (
      <Page>
        <PageHeader title="Admin" back="/" />
        <EmptyState icon={<ShieldOff className="size-8" />} title="Admins only">
          This area is for Voltix platform administrators.
        </EmptyState>
      </Page>
    );
  return (
    <Page>
      <PageHeader title="Admin console" back="/profile" />
      <ChipTabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'users', label: 'Users' },
          { value: 'homes', label: 'Homes' },
          { value: 'boards', label: 'Boards' },
          { value: 'firmware', label: 'Firmware' },
          { value: 'audit', label: 'Audit log' },
        ]}
      />
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'homes' && <Homes />}
      {tab === 'boards' && <Boards />}
      {tab === 'firmware' && <Firmware />}
      {tab === 'audit' && <Audit />}
    </Page>
  );
}

/** Scrollable table that stays usable on phones. */
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <Card className="overflow-x-auto p-0 sm:p-0">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-line border-b text-left text-muted">
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </Card>
  );
}

function Overview() {
  const stats = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () =>
      api.get<{
        users: number;
        homes: number;
        boards: number;
        boardsOnline: number;
        devices: number;
        databaseBytes: number;
        memoryMb: number;
        uptimeS: number;
        partitions: string[];
      }>('/admin/stats'),
    refetchInterval: 15_000,
  });
  const s = stats.data;
  const tiles = s
    ? [
        ['Users', s.users],
        ['Homes', s.homes],
        ['Boards', s.boards],
        ['Boards online', s.boardsOnline],
        ['Devices', s.devices],
        ['Database', `${(s.databaseBytes / 1048576).toFixed(1)} MB`],
        ['Server memory', `${s.memoryMb} MB`],
        ['Uptime', `${Math.floor(s.uptimeS / 3600)} h ${Math.floor((s.uptimeS % 3600) / 60)} m`],
      ]
    : [];
  return (
    <QueryState loading={stats.isPending} error={stats.error}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([k, v]) => (
          <Card key={k} className="p-5">
            <p className="text-muted text-sm">{k}</p>
            <p className="mt-1 font-bold text-2xl text-brand-600">{v}</p>
          </Card>
        ))}
      </div>
      {s && <p className="mt-4 text-muted text-xs">History partitions: {s.partitions.length}</p>}
    </QueryState>
  );
}

type AdminUser = {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: string | null;
  isPlatformAdmin: boolean;
  disabledAt: string | null;
  createdAt: string;
  homes: number;
};

function Users() {
  const { user: me } = useHome();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const users = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: () =>
      api.get<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(query)}`).then((r) => r.users),
  });
  const patch = useApiMutation(
    (v: { id: string; body: { disabled?: boolean; isPlatformAdmin?: boolean } }) =>
      api.patch(`/admin/users/${v.id}`, v.body),
    { invalidate: [['admin', 'users']], success: 'User updated' },
  );
  return (
    <>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <Input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" icon={<Search className="size-4" />} aria-label="Search" />
      </form>
      <QueryState loading={users.isPending} error={users.error}>
        <Table head={['User', 'Homes', 'Joined', 'Status', '']}>
          {users.data?.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-3">
                <p className="font-medium">{u.name}</p>
                <p className="text-muted text-xs">{u.email}</p>
              </td>
              <td className="px-4 py-3">{u.homes}</td>
              <td className="px-4 py-3">{timeAgo(u.createdAt)}</td>
              <td className="space-x-1 px-4 py-3">
                {u.isPlatformAdmin && <Badge>Admin</Badge>}
                {u.disabledAt && <Badge tone="danger">Disabled</Badge>}
                {!u.emailVerifiedAt && <Badge tone="warning">Unverified</Badge>}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                {u.id !== me.id && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={
                        u.isPlatformAdmin ? (
                          <ShieldOff className="size-4" />
                        ) : (
                          <ShieldCheck className="size-4" />
                        )
                      }
                      onClick={() =>
                        patch.mutate({ id: u.id, body: { isPlatformAdmin: !u.isPlatformAdmin } })
                      }
                    >
                      {u.isPlatformAdmin ? 'Remove admin' : 'Make admin'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      icon={<Ban className="size-4" />}
                      onClick={() => patch.mutate({ id: u.id, body: { disabled: !u.disabledAt } })}
                    >
                      {u.disabledAt ? 'Enable' : 'Disable'}
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </>
  );
}

function Homes() {
  const homes = useQuery({
    queryKey: ['admin', 'homes'],
    queryFn: () =>
      api
        .get<{
          homes: {
            id: string;
            name: string;
            timezone: string;
            createdAt: string;
            members: number;
            boards: number;
            devices: number;
            ownerEmail: string;
          }[];
        }>('/admin/homes')
        .then((r) => r.homes),
  });
  return (
    <QueryState loading={homes.isPending} error={homes.error}>
      <Table head={['Home', 'Owner', 'People', 'Boards', 'Devices', 'Created']}>
        {homes.data?.map((h) => (
          <tr key={h.id}>
            <td className="px-4 py-3">
              <p className="font-medium">{h.name}</p>
              <p className="text-muted text-xs">{h.timezone}</p>
            </td>
            <td className="px-4 py-3">{h.ownerEmail}</td>
            <td className="px-4 py-3">{h.members}</td>
            <td className="px-4 py-3">{h.boards}</td>
            <td className="px-4 py-3">{h.devices}</td>
            <td className="px-4 py-3">{timeAgo(h.createdAt)}</td>
          </tr>
        ))}
      </Table>
    </QueryState>
  );
}

function Boards() {
  const boards = useQuery({
    queryKey: ['admin', 'boards'],
    queryFn: () =>
      api
        .get<{
          boards: {
            id: string;
            name: string;
            homeName: string;
            model: string | null;
            firmwareVersion: string | null;
            lastSeenAt: string | null;
            online: boolean;
          }[];
        }>('/admin/boards')
        .then((r) => r.boards),
    refetchInterval: 30_000,
  });
  return (
    <QueryState loading={boards.isPending} error={boards.error}>
      <Table head={['Board', 'Home', 'Model', 'Firmware', 'Status']}>
        {boards.data?.map((b) => (
          <tr key={b.id}>
            <td className="px-4 py-3 font-medium">{b.name}</td>
            <td className="px-4 py-3">{b.homeName}</td>
            <td className="px-4 py-3 font-mono text-xs">{b.model ?? '–'}</td>
            <td className="px-4 py-3 font-mono text-xs">{b.firmwareVersion ?? '–'}</td>
            <td className="px-4 py-3">
              {b.online ? (
                <Badge tone="success">Online</Badge>
              ) : (
                <span className="text-muted">{b.lastSeenAt ? timeAgo(b.lastSeenAt) : 'never'}</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </QueryState>
  );
}

function Firmware() {
  const releases = useQuery({
    queryKey: ['admin', 'firmware'],
    queryFn: () => api.get<{ releases: FirmwareRelease[] }>('/admin/firmware').then((r) => r.releases),
  });
  const rollouts = useQuery({
    queryKey: ['admin', 'rollouts'],
    queryFn: () => api.get<{ rollouts: Rollout[] }>('/admin/rollouts').then((r) => r.rollouts),
    refetchInterval: 10_000,
  });
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({ model: 'voltix-esp32', version: '', notes: '' });
  const upload = useApiMutation(
    () => {
      // Fields first: the server reads them from the multipart stream before the file.
      const fd = new FormData();
      fd.append('model', meta.model);
      fd.append('version', meta.version);
      fd.append('notes', meta.notes);
      fd.append('file', file!);
      return api.post('/admin/firmware', fd);
    },
    {
      invalidate: [['admin', 'firmware']],
      success: 'Firmware uploaded',
      onSuccess: () => {
        setFile(null);
        setMeta((m) => ({ ...m, version: '', notes: '' }));
      },
    },
  );
  const rollout = useApiMutation(
    (releaseId: string) => api.post('/admin/rollouts', { releaseId, target: { all: true } }),
    {
      invalidate: [['admin', 'rollouts']],
      success: 'Rollout started',
    },
  );
  const cancel = useApiMutation((id: string) => api.post(`/admin/rollouts/${id}/cancel`), {
    invalidate: [['admin', 'rollouts']],
    success: 'Rollout cancelled',
  });
  const remove = useApiMutation((id: string) => api.del(`/admin/firmware/${id}`), {
    invalidate: [['admin', 'firmware']],
    success: 'Release deleted',
  });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <h2 className="font-bold text-xl">Upload release</h2>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Model">
              <Input value={meta.model} onChange={(e) => setMeta((m) => ({ ...m, model: e.target.value }))} />
            </Field>
            <Field label="Version">
              <Input
                placeholder="1.1.0"
                value={meta.version}
                onChange={(e) => setMeta((m) => ({ ...m, version: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Release notes">
            <Textarea
              maxLength={2000}
              value={meta.notes}
              onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))}
            />
          </Field>
          <Field label="Firmware (.bin, max 4 MB)">
            <Input
              type="file"
              accept=".bin,application/octet-stream"
              className="pt-2.5"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Button
            icon={<Upload className="size-4" />}
            loading={upload.isPending}
            disabled={!file || !meta.version}
            onClick={() => upload.mutate(undefined)}
          >
            Upload
          </Button>
        </div>
      </Card>

      <div className="space-y-6">
        <section>
          <h2 className="mb-3 font-bold text-xl">Releases</h2>
          <QueryState loading={releases.isPending} error={releases.error}>
            <div className="space-y-3">
              {releases.data?.map((r) => (
                <Card key={r.id} className="flex flex-wrap items-center gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      {r.model} <span className="font-mono">{r.version}</span>
                    </p>
                    <p className="truncate text-muted text-xs">
                      {(r.size / 1024).toFixed(0)} KB · sha256 {r.sha256.slice(0, 12)}… ·{' '}
                      {formatDateTime(r.createdAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    icon={<Rocket className="size-4" />}
                    loading={rollout.isPending && rollout.variables === r.id}
                    onClick={() => rollout.mutate(r.id)}
                  >
                    Roll out to all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => remove.mutate(r.id)}
                  >
                    Delete
                  </Button>
                </Card>
              ))}
              {!releases.data?.length && <p className="text-muted text-sm">No releases uploaded.</p>}
            </div>
          </QueryState>
        </section>
        <section>
          <h2 className="mb-3 font-bold text-xl">Rollouts</h2>
          <QueryState loading={rollouts.isPending} error={rollouts.error}>
            <div className="space-y-3">
              {rollouts.data?.map((r) => {
                const done = (r.counts.succeeded ?? 0) + (r.counts.failed ?? 0) + (r.counts.timeout ?? 0);
                return (
                  <Card key={r.id} className="py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-bold">
                        {r.model} <span className="font-mono">{r.version}</span>
                      </p>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={
                            r.status === 'active' ? 'brand' : r.status === 'completed' ? 'success' : 'muted'
                          }
                        >
                          {r.status}
                        </Badge>
                        {r.status === 'active' && (
                          <button
                            type="button"
                            aria-label="Cancel rollout"
                            onClick={() => cancel.mutate(r.id)}
                            className="text-muted hover:text-danger"
                          >
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-tint">
                      <div
                        className="h-full bg-brand-gradient"
                        style={{ width: `${r.total ? (done / r.total) * 100 : 0}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-muted text-xs">
                      {r.total} boards ·{' '}
                      {Object.entries(r.counts)
                        .map(([k, v]) => `${v} ${k}`)
                        .join(' · ') || 'none yet'}
                    </p>
                  </Card>
                );
              })}
              {!rollouts.data?.length && <p className="text-muted text-sm">No rollouts yet.</p>}
            </div>
          </QueryState>
        </section>
      </div>
    </div>
  );
}

type AuditEntry = {
  id: number;
  at: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  actorEmail: string | null;
  meta: Record<string, unknown>;
};

function Audit() {
  const [action, setAction] = useState('');
  const audit = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.get<{ entries: AuditEntry[] }>('/admin/audit').then((r) => r.entries),
  });
  const actions = [...new Set(audit.data?.map((e) => e.action))].sort();
  const rows = audit.data?.filter((e) => !action || e.action === action);
  return (
    <>
      <Select
        className="mb-4 sm:max-w-xs"
        value={action}
        onChange={(e) => setAction(e.target.value)}
        aria-label="Filter by action"
      >
        <option value="">All actions</option>
        {actions.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </Select>
      <QueryState loading={audit.isPending} error={audit.error}>
        <Table head={['When', 'Who', 'Action', 'Target', 'IP']}>
          {rows?.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap px-4 py-3">{formatDateTime(e.at)}</td>
              <td className="px-4 py-3">{e.actorEmail ?? 'system'}</td>
              <td className="px-4 py-3 font-mono text-xs">{e.action}</td>
              <td className="px-4 py-3 text-xs">
                {e.targetType} {e.targetId?.slice(0, 8)}
              </td>
              <td className="px-4 py-3 font-mono text-xs">{e.ip ?? '–'}</td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </>
  );
}
