'use client';

import { clsx } from 'clsx';
import {
  Activity,
  Cpu,
  House,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  Shield,
  Sparkles,
  Tablet,
  Timer,
  User,
  Users,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/brand';
import { useHome } from '@/components/home-context';
import { Select } from '@/components/ui/field';
import { api } from '@/lib/api';

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: (p: string) => boolean;
}

/** The four destinations of the mobile bottom bar (same order as the design). */
const primary: Item[] = [
  { href: '/', label: 'Home', icon: House, match: (p) => p === '/' },
  { href: '/devices', label: 'Device', icon: Tablet },
  { href: '/rooms', label: 'Room', icon: LayoutGrid },
  { href: '/profile', label: 'Profile', icon: User },
];

const secondary: Item[] = [
  { href: '/scenes', label: 'Scenes', icon: Sparkles },
  { href: '/automations', label: 'Automations', icon: Timer },
  { href: '/energy', label: 'Energy', icon: Zap },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/members', label: 'User access', icon: Users },
  { href: '/boards', label: 'Boards', icon: Cpu },
];

const active = (item: Item, path: string) =>
  item.match ? item.match(path) : path === item.href || path.startsWith(`${item.href}/`);

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="mx-auto flex max-w-xl items-center justify-between rounded-[1.75rem] bg-surface p-2 shadow-nav">
        {primary.map((item) => {
          const on = active(item, path);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on ? 'page' : undefined}
              aria-label={item.label}
              className={clsx(
                'flex h-14 items-center justify-center gap-2 rounded-[1.25rem] transition-all duration-300',
                on
                  ? 'flex-[1.6] bg-brand-gradient px-4 text-white shadow-float'
                  : 'flex-1 text-muted hover:text-ink',
              )}
            >
              <Icon className="size-6 shrink-0" strokeWidth={1.8} />
              {on && <span className="font-bold text-sm uppercase tracking-wide">{item.label}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Sidebar() {
  const path = usePathname();
  const { homes, home, setHomeId, user } = useHome();
  const items = [...primary.slice(0, 3), ...secondary];
  return (
    <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col gap-6 overflow-y-auto border-line border-r bg-surface/80 px-5 py-6 backdrop-blur lg:flex">
      <Link href="/" className="px-2">
        <Logo />
      </Link>
      {homes.length > 1 && (
        <Select aria-label="Current home" value={home.id} onChange={(e) => setHomeId(e.target.value)}>
          {homes.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
      )}
      <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const on = active(item, path);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on ? 'page' : undefined}
              className={clsx(
                'flex h-12 items-center gap-3 rounded-2xl px-4 font-semibold transition',
                on
                  ? 'bg-brand-gradient text-white shadow-float'
                  : 'text-ink-soft hover:bg-brand-50 hover:text-brand-700',
              )}
            >
              <Icon className="size-5" strokeWidth={1.9} />
              {item.label === 'Device' ? 'Devices' : item.label === 'Room' ? 'Rooms' : item.label}
            </Link>
          );
        })}
        {user.isPlatformAdmin && (
          <Link
            href="/admin"
            className={clsx(
              'flex h-12 items-center gap-3 rounded-2xl px-4 font-semibold transition',
              path.startsWith('/admin') ? 'bg-brand-gradient text-white' : 'text-ink-soft hover:bg-brand-50',
            )}
          >
            <Shield className="size-5" strokeWidth={1.9} /> Admin
          </Link>
        )}
      </nav>
      <div className="flex flex-col gap-1">
        <Link
          href="/profile"
          className={clsx(
            'flex items-center gap-3 rounded-2xl p-2 transition hover:bg-brand-50',
            path === '/profile' && 'bg-brand-50',
          )}
        >
          <span className="grid size-10 place-items-center rounded-xl bg-brand-100 font-bold text-brand-700">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-sm">{user.name}</span>
            <span className="block truncate text-muted text-xs">{user.email}</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={async () => {
            await api.post('/auth/logout').catch(() => {});
            window.location.assign('/login');
          }}
          className="flex h-11 items-center gap-3 rounded-2xl px-4 font-semibold text-muted text-sm hover:bg-red-50 hover:text-danger"
        >
          <LogOut className="size-5" /> Sign out
        </button>
      </div>
    </aside>
  );
}
