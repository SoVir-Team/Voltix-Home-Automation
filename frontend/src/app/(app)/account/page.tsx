'use client';

import { useQuery } from '@tanstack/react-query';
import { KeyRound, Laptop, Plus, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Page, PageHeader, QueryState } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Badge } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { Toggle } from '@/components/ui/toggle';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { currentSubscription, disablePush, enablePush, pushSupported } from '@/lib/push';
import { useApiMutation } from '@/lib/queries';
import type { ApiKey, Session } from '@/lib/types';

export default function AccountPage() {
  return (
    <Page>
      <PageHeader title="Account & security" back="/profile" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <PasswordCard />
          <NotificationsCard />
        </div>
        <div className="space-y-6">
          <SessionsCard />
          <ApiKeysCard />
        </div>
      </div>
    </Page>
  );
}

function PasswordCard() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const save = useApiMutation(() => api.post('/me/password', f), {
    success: 'Password changed. Other devices were signed out.',
    onSuccess: () => setF({ currentPassword: '', newPassword: '' }),
  });
  return (
    <Card>
      <h2 className="font-bold text-xl">Password</h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={f.currentPassword}
            onChange={(e) => setF((s) => ({ ...s, currentPassword: e.target.value }))}
          />
        </Field>
        <Field label="New password" hint="At least 10 characters.">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={f.newPassword}
            onChange={(e) => setF((s) => ({ ...s, newPassword: e.target.value }))}
          />
        </Field>
        <Button
          type="submit"
          loading={save.isPending}
          disabled={!f.currentPassword || f.newPassword.length < 10}
        >
          Change password
        </Button>
      </form>
    </Card>
  );
}

const typeLabels: Record<string, string> = {
  doorbell: 'Doorbell',
  motion: 'Motion',
  contact: 'Doors & windows',
  device_offline: 'Board offline',
  automation: 'Automation alerts',
  ota: 'Firmware updates',
  security: 'Account security',
};
type Pref = { type: string; inApp: boolean; push: boolean; email: boolean };

function NotificationsCard() {
  const prefs = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => api.get<{ prefs: Pref[]; pushAvailable: boolean }>('/notifications/prefs'),
  });
  const [rows, setRows] = useState<Pref[] | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (prefs.data) setRows(prefs.data.prefs);
  }, [prefs.data]);
  useEffect(() => {
    void currentSubscription().then((s) => setPushOn(!!s));
  }, []);

  const save = useApiMutation((next: Pref[]) => api.put('/notifications/prefs', { prefs: next }), {
    invalidate: [['notification-prefs']],
  });
  const update = (type: string, key: 'inApp' | 'push' | 'email', v: boolean) => {
    const next = rows!.map((r) => (r.type === type ? { ...r, [key]: v } : r));
    setRows(next);
    save.mutate(next);
  };

  return (
    <Card id="notifications">
      <h2 className="font-bold text-xl">Notifications</h2>
      {prefs.data?.pushAvailable && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl bg-tint p-4">
          <div className="min-w-0">
            <p className="font-semibold">Push on this device</p>
            <p className="text-muted text-sm">
              {pushSupported()
                ? 'Alerts even when Voltix is closed.'
                : 'On iPhone, add Voltix to the Home Screen first.'}
            </p>
          </div>
          <Toggle
            label="Push on this device"
            checked={pushOn}
            disabled={busy || !pushSupported()}
            onChange={async (v) => {
              setBusy(true);
              try {
                if (v) await enablePush();
                else await disablePush();
                setPushOn(v);
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      )}
      <QueryState loading={prefs.isPending} error={prefs.error}>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2 font-medium">Alert</th>
              <th className="w-16 py-2 text-center font-medium">In app</th>
              {prefs.data?.pushAvailable && <th className="w-16 py-2 text-center font-medium">Push</th>}
              <th className="w-16 py-2 text-center font-medium">Email</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows?.map((r) => (
              <tr key={r.type}>
                <td className="py-3">{typeLabels[r.type] ?? r.type}</td>
                {(['inApp', ...(prefs.data?.pushAvailable ? ['push'] : []), 'email'] as const).map((k) => (
                  <td key={k} className="text-center">
                    <Checkbox
                      label=""
                      className="justify-center"
                      aria-label={`${typeLabels[r.type]} ${k}`}
                      checked={r[k as 'inApp']}
                      onChange={(e) => update(r.type, k as 'inApp', e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </QueryState>
    </Card>
  );
}

function deviceName(ua: string | null) {
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /node|undici/i.test(ua)
            ? 'API client'
            : 'Browser';
  return `${browser} on ${os}`;
}

function SessionsCard() {
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<{ sessions: Session[] }>('/me/sessions').then((r) => r.sessions),
  });
  const revoke = useApiMutation((id: string) => api.del(`/me/sessions/${id}`), {
    invalidate: [['sessions']],
    success: 'Signed out',
  });
  return (
    <Card>
      <h2 className="font-bold text-xl">Signed-in devices</h2>
      <QueryState loading={sessions.isPending} error={sessions.error}>
        <ul className="mt-4 divide-y divide-line">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              {/Mobile|Android|iPhone/.test(s.userAgent ?? '') ? (
                <Smartphone className="size-5 text-muted" />
              ) : (
                <Laptop className="size-5 text-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {deviceName(s.userAgent)} {s.current && <Badge className="ml-1">This device</Badge>}
                </p>
                <p className="truncate text-muted text-xs">
                  {s.ip ?? 'Unknown IP'} · signed in {timeAgo(s.createdAt)}
                </p>
              </div>
              {!s.current && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={revoke.isPending && revoke.variables === s.id}
                  onClick={() => revoke.mutate(s.id)}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </QueryState>
    </Card>
  );
}

function ApiKeysCard() {
  const keys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get<{ apiKeys: ApiKey[]; availableScopes: string[] }>('/me/api-keys'),
  });
  const [creating, setCreating] = useState(false);
  const revoke = useApiMutation((id: string) => api.del(`/me/api-keys/${id}`), {
    invalidate: [['api-keys']],
    success: 'Key revoked',
  });
  const active = keys.data?.apiKeys.filter((k) => !k.revokedAt) ?? [];
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-xl">API keys</h2>
        <Button
          size="sm"
          variant="outline"
          icon={<Plus className="size-4" />}
          onClick={() => setCreating(true)}
        >
          New key
        </Button>
      </div>
      <p className="mt-1 text-muted text-sm">
        For your own scripts and integrations. Docs at <code className="text-ink-soft">/api/docs</code>.
      </p>
      <QueryState loading={keys.isPending} error={keys.error}>
        <ul className="mt-3 divide-y divide-line">
          {active.map((k) => (
            <li key={k.id} className="flex items-center gap-3 py-3">
              <KeyRound className="size-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{k.name}</p>
                <p className="truncate text-muted text-xs">
                  {k.prefix}… · {k.scopes.join(', ')} ·{' '}
                  {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : 'never used'}
                  {k.expiresAt && ` · expires ${formatDateTime(k.expiresAt)}`}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Revoke ${k.name}`}
                onClick={() => revoke.mutate(k.id)}
                className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
          {!active.length && <li className="py-3 text-muted text-sm">No API keys.</li>}
        </ul>
      </QueryState>
      {creating && (
        <NewKeySheet scopes={keys.data?.availableScopes ?? []} onClose={() => setCreating(false)} />
      )}
    </Card>
  );
}

const scopeLabels: Record<string, string> = {
  'homes:read': 'Read homes and rooms',
  'devices:read': 'Read devices and state',
  'devices:control': 'Control devices',
  'scenes:run': 'Run scenes',
};

function NewKeySheet({ scopes, onClose }: { scopes: string[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>(['homes:read', 'devices:read']);
  const [days, setDays] = useState('365');
  const [key, setKey] = useState<string | null>(null);
  const create = useApiMutation(
    () =>
      api.post<{ key: string }>('/me/api-keys', {
        name: name.trim(),
        scopes: picked,
        ...(days ? { expiresInDays: Number(days) } : {}),
      }),
    { invalidate: [['api-keys']], onSuccess: (r) => setKey(r.key) },
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title={key ? 'Your new API key' : 'New API key'}
      footer={
        key ? (
          <Button className="w-full" size="lg" onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button
            className="w-full"
            size="lg"
            loading={create.isPending}
            disabled={!name.trim() || !picked.length}
            onClick={() => create.mutate(undefined)}
          >
            Create key
          </Button>
        )
      }
    >
      {key ? (
        <div className="space-y-4">
          <CopyField label="API key" value={key} secret />
          <p className="rounded-2xl bg-amber-50 p-3 text-amber-800 text-sm">
            Copy it now — it won't be shown again. Send it as <code>Authorization: Bearer …</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <Field label="Name">
            <Input
              maxLength={60}
              placeholder="e.g. Home Assistant"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div>
            <span className="mb-2 block font-semibold text-ink-soft text-sm">Allowed to</span>
            <div className="space-y-3">
              {scopes.map((s) => (
                <Checkbox
                  key={s}
                  label={scopeLabels[s] ?? s}
                  checked={picked.includes(s)}
                  onChange={(e) =>
                    setPicked((p) => (e.target.checked ? [...p, s] : p.filter((x) => x !== s)))
                  }
                />
              ))}
            </div>
          </div>
          <Field label="Expires after (days)" hint="Leave empty for no expiry.">
            <Input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}
