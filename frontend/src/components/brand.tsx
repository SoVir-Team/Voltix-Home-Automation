import { clsx } from 'clsx';

/** The Voltix bolt: two cyan facets, as in the logo. */
export function Bolt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="vx-bolt-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3fbcec" />
          <stop offset="1" stopColor="#1ba8e0" />
        </linearGradient>
        <linearGradient id="vx-bolt-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1ba8e0" />
          <stop offset="1" stopColor="#128bc4" />
        </linearGradient>
      </defs>
      <path d="M35 2h19L40 23h12L21 62l8-27H15z" fill="url(#vx-bolt-a)" />
      <path d="M40 23h12L21 62l8-27z" fill="url(#vx-bolt-b)" />
      <path d="M35 2h19L40 23H29z" fill="#fff" fillOpacity=".18" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <Bolt className="size-9" />
      {!compact && <span className="font-extrabold text-[1.35rem] text-ink tracking-[0.22em]">VOLTIX</span>}
    </span>
  );
}
