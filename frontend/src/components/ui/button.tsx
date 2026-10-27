import { clsx } from 'clsx';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Spinner } from './misc';

type Variant = 'primary' | 'outline' | 'ghost' | 'soft' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-gradient text-white shadow-float hover:brightness-105',
  outline: 'border-2 border-brand-400 text-brand-600 bg-surface hover:bg-brand-50',
  ghost: 'text-brand-600 hover:bg-brand-50',
  soft: 'bg-tint text-ink-soft hover:bg-brand-50',
  danger: 'bg-danger text-white hover:brightness-110',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm gap-1.5',
  md: 'h-11 px-5 text-[15px] gap-2',
  lg: 'h-14 px-6 text-lg gap-2.5',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return clsx(
    'inline-flex select-none items-center justify-center rounded-full font-semibold transition',
    'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant,
  size,
  loading,
  icon,
  className,
  children,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant,
  size,
  icon,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}

/** Round white button used in page headers (back, filters, more). */
export function IconButton({
  label,
  className,
  children,
  badge,
  ...props
}: ComponentProps<'button'> & { label: string; badge?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'relative grid size-11 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-card transition sm:size-12',
        'hover:text-brand-600 active:scale-95',
        className,
      )}
      {...props}
    >
      {children}
      {badge && (
        <span className="absolute top-2.5 right-3 size-2.5 rounded-full bg-danger ring-2 ring-surface" />
      )}
    </button>
  );
}

export function IconLink({
  href,
  label,
  className,
  children,
  badge,
}: {
  href: string;
  label: string;
  className?: string;
  children: ReactNode;
  badge?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={clsx(
        'relative grid size-11 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-card transition sm:size-12',
        'hover:text-brand-600 active:scale-95',
        className,
      )}
    >
      {children}
      {badge && (
        <span className="absolute top-2.5 right-3 size-2.5 rounded-full bg-danger ring-2 ring-surface" />
      )}
    </Link>
  );
}
