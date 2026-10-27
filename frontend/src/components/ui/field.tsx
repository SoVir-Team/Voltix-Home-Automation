import { clsx } from 'clsx';
import type { ComponentProps, ReactNode } from 'react';

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block font-semibold text-ink-soft text-sm">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-danger text-sm">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-muted text-xs">{hint}</span>
      )}
    </label>
  );
}

const control =
  'w-full rounded-2xl border border-line bg-surface px-4 text-ink placeholder:text-subtle outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100 disabled:opacity-60';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={clsx(control, 'h-12', className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={clsx(
        control,
        'h-12 appearance-none bg-[length:16px] bg-[right_1rem_center] bg-no-repeat pr-10',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b7a99' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={clsx(control, 'min-h-24 py-3', className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: ComponentProps<'input'> & { label: ReactNode }) {
  return (
    <label className={clsx('flex cursor-pointer items-center gap-3 text-sm', className)}>
      <input type="checkbox" className="size-5 rounded-md accent-brand-500" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Pill buttons for picking weekdays (0 = Sunday). */
export function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (
    <div className="flex gap-1.5">
      {days.map((d, i) => {
        const on = value.includes(i);
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: weekday index is the identity
            key={i}
            type="button"
            aria-pressed={on}
            aria-label={names[i]}
            onClick={() => onChange(on ? value.filter((x) => x !== i) : [...value, i].sort())}
            className={clsx(
              'grid size-10 place-items-center rounded-full font-semibold text-sm transition',
              on ? 'bg-brand-gradient text-white' : 'bg-surface text-muted shadow-card',
            )}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}
