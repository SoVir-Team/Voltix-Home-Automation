'use client';

import {
  Activity,
  Bell,
  ChevronRight,
  Code2,
  Cpu,
  House,
  LogOut,
  Pencil,
  ShieldCheck,
  ShieldUser,
  Sparkles,
  Tablet,
  Timer,
  Users,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { useHome } from '@/components/home-context';
import { Page } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { ListRow, SectionHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { Avatar, Badge } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { qk, useApiMutation } from '@/lib/queries';

const chevron = <ChevronRight className="size-5 shrink-0 text-ink" />;

export default function ProfilePage() {
  const { user, home, canManage } = useHome();
  const [editing, setEditing] = useState(false);

  const prefs = [
    { href: '/energy', icon: Zap, title: 'Energy Dashboard', subtitle: 'Track and analyze energy use' },
    { href: '/devices', icon: Tablet, title: 'Device Management', subtitle: 'View, add, or remove devices' },
    {
      href: '/settings',
      icon: House,
      title: 'Manage Homes',
      subtitle: `${home.name} · timezone, tariff, homes`,
    },
    { href: '/members', icon: Users, title: 'User Access', subtitle: 'Share control with family' },
    { href: '/scenes', icon: Sparkles, title: 'Scenes', subtitle: 'One tap for many devices' },
    {
      href: '/automations',
      icon: Timer,
      title: 'Schedules & Automations',
      subtitle: 'Timers, routines and rules',
    },
    ...(canManage
      ? [
          {
            href: '/boards',
            icon: Cpu,
            title: 'Boards & Firmware',
            subtitle: 'Keep your devices up to date',
          },
          {
            href: '/templates',
            icon: Code2,
            title: 'Device Templates',
            subtitle: 'Custom types and firmware code',
          },
        ]
      : []),
    { href: '/activity', icon: Activity, title: 'Activity', subtitle: 'Who did what, and when' },
    { href: '/notifications', icon: Bell, title: 'Notifications', subtitle: 'Alerts from your home' },
    {
      href: '/account',
      icon: ShieldCheck,
      title: 'Account & Security',
      subtitle: 'Password, sessions, API keys',
    },
    ...(user.isPlatformAdmin
      ? [
          {
            href: '/admin',
            icon: ShieldUser,
            title: 'Admin Console',
            subtitle: 'Users, homes, firmware rollouts',
          },
        ]
      : []),
  ];

  return (
    <Page>
      <h1 className="pt-4 pb-6 font-bold text-3xl lg:pt-0">Profile</h1>

      <div className="flex items-center gap-5">
        <div className="rounded-[1.6rem] p-1 ring-2 ring-brand-400">
          <Avatar name={user.name} size={96} className="rounded-[1.3rem]! ring-0" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-bold text-2xl">{user.name}</p>
          <p className="truncate text-muted">{user.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 font-medium text-brand-500 hover:text-brand-700"
            >
              <Pencil className="size-4" /> Edit Profile
            </button>
            {!user.emailVerified && <Badge tone="warning">Email not verified</Badge>}
          </div>
        </div>
      </div>

      <section className="mt-8">
        <SectionHeader title="App Preferences" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {prefs.map((p) => (
            <ListRow
              key={p.href}
              href={p.href}
              icon={<p.icon className="size-6" />}
              title={p.title}
              subtitle={p.subtitle}
              trailing={chevron}
            />
          ))}
        </div>
      </section>

      <Button
        variant="soft"
        size="lg"
        className="mt-8 w-full text-danger lg:w-auto"
        icon={<LogOut className="size-5" />}
        onClick={async () => {
          await api.post('/auth/logout').catch(() => {});
          window.location.assign('/login');
        }}
      >
        Sign out
      </Button>

      <EditProfileSheet open={editing} onClose={() => setEditing(false)} name={user.name} />
    </Page>
  );
}

function EditProfileSheet({ open, onClose, name }: { open: boolean; onClose: () => void; name: string }) {
  const [value, setValue] = useState(name);
  const save = useApiMutation(() => api.patch('/me', { name: value.trim() }), {
    invalidate: [qk.me],
    success: 'Profile updated',
    onSuccess: onClose,
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit profile"
      footer={
        <Button
          className="w-full"
          size="lg"
          loading={save.isPending}
          disabled={!value.trim()}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) save.mutate();
        }}
      >
        <Field label="Name">
          <Input
            autoComplete="name"
            maxLength={80}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}
