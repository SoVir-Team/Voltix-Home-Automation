'use client';

import { clsx } from 'clsx';
import { Icon } from '@/components/icon';

export function IconPicker({
  icons,
  value,
  onChange,
}: {
  icons: readonly string[];
  value: string;
  onChange: (icon: string) => void;
}) {
  return (
    <div>
      <span className="mb-2 block font-semibold text-ink-soft text-sm">Icon</span>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
        {icons.map((i) => (
          <button
            key={i}
            type="button"
            aria-label={i}
            aria-pressed={value === i}
            onClick={() => onChange(i)}
            className={clsx(
              'grid aspect-square place-items-center rounded-2xl transition',
              value === i ? 'bg-brand-gradient text-white shadow-float' : 'bg-surface text-muted shadow-card',
            )}
          >
            <Icon name={i} className="size-6" />
          </button>
        ))}
      </div>
    </div>
  );
}
