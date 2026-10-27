import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { initials } from '@/lib/format';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className ?? 'size-5')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-card bg-line/70', className)} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-card bg-surface px-6 py-12 text-center shadow-card">
      <div className="mb-4 grid size-16 place-items-center rounded-2xl bg-brand-50 text-brand-500">
        {icon}
      </div>
      <h3 className="font-bold text-lg">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-muted text-sm">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Badge({
  tone = 'brand',
  children,
  className,
}: {
  tone?: 'brand' | 'muted' | 'success' | 'danger' | 'warning';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    muted: 'bg-tint text-muted',
    success: 'bg-green-50 text-success',
    danger: 'bg-red-50 text-danger',
    warning: 'bg-amber-50 text-warning',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold text-xs',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  // Stable hue per name so family members are easy to tell apart.
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      className={clsx(
        'grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-surface',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${h} 75% 62%), hsl(${(h + 40) % 360} 70% 48%))`,
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Small status dot with label (online/offline). */
