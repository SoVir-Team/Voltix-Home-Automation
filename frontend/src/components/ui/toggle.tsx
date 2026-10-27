'use client';

import { clsx } from 'clsx';

/** The ON/OFF pill switch from the design: label sits inside the track, opposite the knob. */
export function Toggle({
  checked,
  onChange,
  label,
  size = 'md',
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!checked);
      }}
      className={clsx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50',
        // generous hit area without changing the visual size
        'before:absolute before:-inset-2 before:content-[""]',
        sm ? 'h-7 w-[3.25rem]' : 'h-10 w-[4.75rem]',
        checked ? 'bg-brand-gradient shadow-float' : 'bg-line',
        className,
      )}
    >
      <span
        className={clsx(
          'absolute font-bold uppercase tracking-wide transition-opacity',
          sm ? 'text-[9px]' : 'text-[11px]',
          checked
            ? sm
              ? 'left-2 text-white'
              : 'left-3 text-white'
            : sm
              ? 'right-1.5 text-muted'
              : 'right-2.5 text-muted',
        )}
      >
        {checked ? 'On' : 'Off'}
      </span>
      <span
        className={clsx(
          'absolute rounded-full bg-white shadow transition-transform duration-200 ease-out',
          sm ? 'top-1 left-1 size-5' : 'top-1 left-1 size-8',
          checked && (sm ? 'translate-x-[1.5rem]' : 'translate-x-[2.25rem]'),
        )}
      />
    </button>
  );
}
