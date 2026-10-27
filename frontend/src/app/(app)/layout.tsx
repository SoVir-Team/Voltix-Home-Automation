'use client';

import { House } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Logo } from '@/components/brand';
import { HomeProvider } from '@/components/home-context';
import { BottomNav, Sidebar } from '@/components/layout/nav';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { qk, useApiMutation, useHomes, useMe } from '@/lib/queries';
import type { Home } from '@/lib/types';

export default function AppLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const homes = useHomes();

  if (me.isPending || homes.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-4 text-brand-500">
          <Logo />
          <Spinner />
        </div>
      </div>
    );
  }
  if (me.isError || homes.isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="font-semibold">We couldn't reach Voltix.</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!homes.data.length) return <FirstHome />;

  return (
    <HomeProvider user={me.data} homes={homes.data}>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <BottomNav />
    </HomeProvider>
  );
}

/** Someone who left every home (or whose home was deleted) starts here. */
function FirstHome() {
  const [name, setName] = useState('My Home');
  const create = useApiMutation((n: string) => api.post<{ home: Home }>('/homes', { name: n }), {
    invalidate: [qk.homes],
  });
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <form
        className="w-full max-w-sm rounded-card bg-surface p-8 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(name);
        }}
      >
        <div className="mb-6 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-500">
          <House className="size-7" />
        </div>
        <h1 className="font-bold text-2xl">Create your home</h1>
        <p className="mt-1 mb-6 text-muted">Rooms, devices and family members all live inside a home.</p>
        <Field label="Home name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </Field>
        <Button type="submit" className="mt-6 w-full" loading={create.isPending}>
          Create home
        </Button>
      </form>
    </div>
  );
}
