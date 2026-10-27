'use client';

import { clsx } from 'clsx';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/button';

/** Page body: mobile gutters, room for the floating bottom nav, comfortable max width on desktop. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main
      className={clsx(
        'mx-auto w-full max-w-6xl px-4 pt-safe pb-32 sm:px-6 lg:px-10 lg:pt-8 lg:pb-12',
        className,
      )}
    >
      {children}
    </main>
  );
}

/** Centered title with round back/action buttons, as on the detail screens. */
export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Show a back button (router.back, falling back to this href). */
  back?: string;
  actions?: ReactNode;
}) {
  const router = useRouter();
  return (
    <header className="mb-6 grid grid-cols-[3rem_1fr_auto] items-center gap-3 pt-3 lg:pt-0">
      <div>
        {back && (
          <IconButton
            label="Back"
            onClick={() => (window.history.length > 1 ? router.back() : router.push(back))}
          >
            <ChevronLeft className="size-6" />
          </IconButton>
        )}
      </div>
      <div className="min-w-0 text-center">
        <h1 className="truncate font-bold text-2xl">{title}</h1>
        {subtitle && <p className="truncate text-muted text-sm">{subtitle}</p>}
      </div>
      <div className="flex min-w-12 justify-end gap-2">{actions}</div>
    </header>
  );
}

/** Loading / error wrapper for query-driven pages. */
export function QueryState({
  loading,
  error,
  children,
  skeleton,
}: {
  loading: boolean;
  error: unknown;
  children: ReactNode;
  skeleton?: ReactNode;
}) {
  if (loading) return <>{skeleton ?? <div className="h-40 animate-pulse rounded-card bg-line/60" />}</>;
  if (error)
    return (
      <div className="rounded-card bg-red-50 p-6 text-danger">
        {error instanceof Error ? error.message : 'Could not load this page.'}
      </div>
    );
  return <>{children}</>;
}
