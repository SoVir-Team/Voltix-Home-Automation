'use client';

import { MailPlus, Pencil, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useHome } from '@/components/home-context';
import { Page, PageHeader, QueryState } from '@/components/layout/page';
import { Button } from '@/components/ui/button';
import { Card, SectionHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Avatar, Badge } from '@/components/ui/misc';
import { ConfirmSheet, Sheet } from '@/components/ui/sheet';
import { Toggle } from '@/components/ui/toggle';
import { api } from '@/lib/api';
import { timeAgo, titleCase } from '@/lib/format';
import { qk, useApiMutation, useMembers } from '@/lib/queries';
import type { HomeRole, Member, MemberPermissions } from '@/lib/types';

const areas: { key: keyof MemberPermissions; title: string }[] = [
  { key: 'locks', title: 'Lock / Unlock Doors' },
  { key: 'energy', title: 'Energy Usage Reports' },
  { key: 'lighting', title: 'Lighting Control' },
  { key: 'climate', title: 'Climate & Fans' },
];

export default function MembersPage() {
  const { user, home, canManage, isOwner } = useHome();
  const members = useMembers(home.id);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);

  const setPermission = useApiMutation(
    (patch: Partial<MemberPermissions>) => api.patch(`/homes/${home.id}`, { memberPermissions: patch }),
    { invalidate: [qk.homes] },
  );
  const revoke = useApiMutation((id: string) => api.del(`/homes/${home.id}/invites/${id}`), {
    invalidate: [qk.members(home.id)],
    success: 'Invite cancelled',
  });

  const list = members.data?.members ?? [];
  const memberCount = list.filter((m) => m.role === 'member').length;

  return (
    <Page>
      <PageHeader title="User Access" back="/profile" />
      <h1 className="mb-5 font-medium text-[2rem] leading-tight tracking-tight sm:text-4xl">
        Smarter Living, Managed Together
      </h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-bold text-2xl">User Access</h2>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<UserPlus className="size-4" />}
                  onClick={() => setInviting(true)}
                >
                  Invite
                </Button>
              )}
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="-space-x-3 flex">
                {list.slice(0, 4).map((m) => (
                  <Avatar key={m.userId} name={m.name} size={44} className="ring-4 ring-surface" />
                ))}
              </div>
              <div className="text-right">
                <p className="font-bold">
                  {list.length} {list.length === 1 ? 'person' : 'people'}
                </p>
                <p className="text-muted text-sm">have access</p>
              </div>
            </div>
            <p className="mt-6 text-lg leading-snug">
              Share control with family,
              <br />
              with your permission.
            </p>
          </Card>

          {areas.map((a) => {
            const on = home.memberPermissions[a.key];
            return (
              <Card key={a.key} className="flex items-center justify-between gap-4 py-5">
                <div className="min-w-0">
                  <p className="font-bold">{a.title}</p>
                  <p className="text-muted text-sm">{on ? 'All members' : 'Owners & admins only'}</p>
                </div>
                <Toggle
                  checked={on}
                  label={a.title}
                  disabled={!isOwner || setPermission.isPending}
                  onChange={(v) => setPermission.mutate({ [a.key]: v })}
                />
              </Card>
            );
          })}
          {!isOwner && (
            <p className="text-muted text-sm">Only the home owner can change what members may control.</p>
          )}
        </div>

        <section>
          <SectionHeader title="People" action={<Badge tone="muted">{memberCount} members</Badge>} />
          <QueryState loading={members.isPending} error={members.error}>
            <div className="space-y-3">
              {list.map((m) => (
                <Card key={m.userId} className="flex items-center gap-4 py-4">
                  <Avatar name={m.name} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">
                      {m.name}
                      {m.userId === user.id && <span className="font-normal text-muted"> (you)</span>}
                    </p>
                    <p className="truncate text-muted text-sm">{m.email}</p>
                  </div>
                  <Badge tone={m.role === 'member' ? 'muted' : 'brand'}>{titleCase(m.role)}</Badge>
                  {(canManage || m.userId === user.id) && (
                    <button
                      type="button"
                      aria-label={`Edit ${m.name}`}
                      onClick={() => setEditing(m)}
                      className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-brand-600"
                    >
                      <Pencil className="size-4" />
                    </button>
                  )}
                </Card>
              ))}
              {members.data?.invites.map((inv) => (
                <Card
                  key={inv.id}
                  className="flex items-center gap-4 border-2 border-line border-dashed py-4 shadow-none"
                >
                  <div className="grid size-12 shrink-0 place-items-center rounded-full bg-tint text-brand-500">
                    <MailPlus className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{inv.email}</p>
                    <p className="truncate text-muted text-sm">
                      Invited as {inv.role} · expires {timeAgo(inv.expiresAt)}
                    </p>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      aria-label={`Cancel invite for ${inv.email}`}
                      onClick={() => revoke.mutate(inv.id)}
                      className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </Card>
              ))}
            </div>
          </QueryState>
        </section>
      </div>

      <InviteSheet open={inviting} onClose={() => setInviting(false)} homeId={home.id} />
      {editing && <MemberSheet member={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function InviteSheet({ open, onClose, homeId }: { open: boolean; onClose: () => void; homeId: string }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const invite = useApiMutation(
    (body: { email: string; role: string }) => api.post(`/homes/${homeId}/invites`, body),
    {
      invalidate: [qk.members(homeId)],
      success: 'Invitation sent',
      onSuccess: () => {
        setEmail('');
        onClose();
      },
    },
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Invite someone"
      footer={
        <Button
          className="w-full"
          size="lg"
          loading={invite.isPending}
          disabled={!email}
          onClick={() => invite.mutate({ email, role })}
        >
          Send invite
        </Button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (email) invite.mutate({ email, role });
        }}
      >
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Role" hint="Admins can add devices, rooms and people. Members only control devices.">
          <Select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
        <p className="text-muted text-sm">They'll get an email with a link that works for 7 days.</p>
      </form>
    </Sheet>
  );
}

function MemberSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const { user, home, canManage, isOwner } = useHome();
  const self = member.userId === user.id;
  const [role, setRole] = useState<HomeRole>(member.role);
  const [confirm, setConfirm] = useState(false);
  const canEditRole = canManage && !self && (isOwner || member.role !== 'owner');

  const save = useApiMutation(() => api.patch(`/homes/${home.id}/members/${member.userId}`, { role }), {
    invalidate: [qk.members(home.id)],
    success: 'Role updated',
    onSuccess: onClose,
  });
  const remove = useApiMutation(() => api.del(`/homes/${home.id}/members/${member.userId}`), {
    invalidate: [qk.members(home.id), qk.homes],
    success: self ? `You left ${home.name}` : `${member.name} removed`,
    onSuccess: () => {
      onClose();
      if (self) window.location.assign('/');
    },
  });

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={member.name}
        footer={
          canEditRole && (
            <Button
              className="w-full"
              size="lg"
              loading={save.isPending}
              disabled={role === member.role}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          )
        }
      >
        <div className="flex items-center gap-4">
          <Avatar name={member.name} size={56} />
          <div className="min-w-0">
            <p className="truncate font-bold">{member.email}</p>
            <p className="text-muted text-sm">Joined {timeAgo(member.joinedAt)}</p>
          </div>
        </div>
        {canEditRole && (
          <Field label="Role" className="mt-6">
            <Select value={role} onChange={(e) => setRole(e.target.value as HomeRole)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              {isOwner && <option value="owner">Owner</option>}
            </Select>
          </Field>
        )}
        <Button
          variant="soft"
          className="mt-6 w-full text-danger"
          icon={<Trash2 className="size-4" />}
          onClick={() => setConfirm(true)}
        >
          {self ? 'Leave this home' : 'Remove from home'}
        </Button>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title={self ? 'Leave home?' : `Remove ${member.name}?`}
        message={
          self
            ? `You'll lose access to ${home.name}.`
            : `${member.name} will lose access to ${home.name} right away.`
        }
        confirmLabel={self ? 'Leave' : 'Remove'}
      />
    </>
  );
}
