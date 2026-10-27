'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Realtime } from '@/lib/realtime';
import type { Home, User } from '@/lib/types';

interface HomeCtx {
  user: User;
  homes: Home[];
  home: Home;
  setHomeId: (id: string) => void;
  /** Owner or admin of the current home. */
  canManage: boolean;
  isOwner: boolean;
  live: boolean;
}

const Ctx = createContext<HomeCtx | null>(null);
const KEY = 'voltix.home';

export function HomeProvider({ user, homes, children }: { user: User; homes: Home[]; children: ReactNode }) {
  const qc = useQueryClient();
  const [homeId, setId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [rt] = useState(() => new Realtime(qc));

  useEffect(() => {
    setId(localStorage.getItem(KEY));
  }, []);

  const home = homes.find((h) => h.id === homeId) ?? homes[0]!;

  const setHomeId = useCallback((id: string) => {
    localStorage.setItem(KEY, id);
    setId(id);
  }, []);

  useEffect(() => {
    rt.onStatus = setLive;
    rt.start(home.id);
  }, [rt, home.id]);

  useEffect(() => () => rt.stop(), [rt]);

  const value = useMemo(
    () => ({
      user,
      homes,
      home,
      setHomeId,
      canManage: home.role !== 'member',
      isOwner: home.role === 'owner',
      live,
    }),
    [user, homes, home, setHomeId, live],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHome(): HomeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHome outside HomeProvider');
  return v;
}
