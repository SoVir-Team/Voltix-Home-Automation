import { clsx } from 'clsx';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={clsx('rounded-card bg-surface p-5 shadow-card sm:p-6', className)} {...props} />;
}

export function SectionHeader({
  title,
  href,
  linkLabel = 'View all',
  action,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-bold text-xl">{title}</h2>
      {href && (
        <Link href={href} className="font-medium text-brand-500 text-sm hover:text-brand-700">
          {linkLabel}
        </Link>
      )}
      {action}
    </div>
  );
}

/** Gradient banner with the arc decoration (energy, device totals, add-device header). */
export function Hero({
  icon,
  title,
  subtitle,
  aside,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'relative isolate flex items-center gap-4 overflow-hidden rounded-[2rem] bg-brand-gradient px-6 py-5 text-white shadow-float sm:px-8 sm:py-6',
        className,
      )}
    >
      <svg
        className="-z-10 pointer-events-none absolute top-0 right-0 h-full w-1/2"
        viewBox="0 0 200 120"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M60 0 C 70 70, 130 115, 200 120"
          fill="none"
          stroke="white"
          strokeOpacity=".25"
          strokeWidth="1"
        />
        <circle cx="210" cy="-10" r="90" fill="white" fillOpacity=".06" />
      </svg>
      {icon && <div className="shrink-0 opacity-95">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-lg sm:text-xl">{title}</div>
        {subtitle && <div className="truncate text-sm text-white/85">{subtitle}</div>}
      </div>
      {aside}
    </div>
  );
}

/** White list row with tinted icon, title, subtitle and trailing content (profile prefs, energy usage). */
export function ListRow({
  icon,
  title,
  subtitle,
  trailing,
  href,
  onClick,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      {icon && (
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-500">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{title}</div>
        {subtitle && <div className="truncate text-muted text-sm">{subtitle}</div>}
      </div>
      {trailing}
    </>
  );
  const cls = clsx(
    'flex w-full items-center gap-4 rounded-[1.5rem] bg-surface p-3 pr-5 text-left shadow-card transition',
    (href || onClick) && 'hover:ring-2 hover:ring-brand-200 active:scale-[0.99]',
    className,
  );
  if (href)
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}
