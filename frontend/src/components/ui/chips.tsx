'use client';

import { clsx } from 'clsx';

/** Horizontally scrolling filter chips ("All / Living Room / Kitchen"). */
export function ChipTabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={clsx('no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 py-1 sm:mx-0 sm:px-0', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              'h-11 shrink-0 whitespace-nowrap rounded-full px-6 font-medium text-[15px] transition active:scale-95',
              active
                ? 'bg-brand-gradient text-white shadow-float'
                : 'bg-surface text-ink shadow-card hover:text-brand-600',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Segmented control for 2–4 options (Weekly/Monthly, Schedules/Timers/Automations). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={clsx('inline-flex rounded-full bg-surface p-1 shadow-card', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'h-9 flex-1 whitespace-nowrap rounded-full px-4 font-semibold text-sm transition',
            o.value === value ? 'bg-brand-gradient text-white shadow-float' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Square selectable tile with icon + label (AC modes, light moods). */
export function ModeTile({
  active,
  label,
  icon,
  onClick,
  disabled,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex flex-col items-center justify-center gap-2 rounded-tile px-2 py-4 shadow-card transition active:scale-95 disabled:opacity-50',
        active
          ? 'bg-brand-50 text-brand-600 ring-2 ring-brand-400'
          : 'bg-surface text-ink-soft hover:text-brand-600',
      )}
    >
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
}
