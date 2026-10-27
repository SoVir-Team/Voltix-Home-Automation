'use client';

import { clsx } from 'clsx';
import { useId, useState } from 'react';

/**
 * Bar chart in the style of the energy screen: pale bars, the selected (default: highest) bar in the brand
 * gradient, and a dashed reference line labelled with its value. Tap a bar to inspect it.
 */
export function BarChart({
  data,
  unit,
  className,
}: {
  data: { label: string; value: number; title?: string }[];
  unit: string;
  className?: string;
}) {
  const gid = useId();
  const max = Math.max(...data.map((d) => d.value), 0);
  const peak = data.findIndex((d) => d.value === max);
  const [sel, setSel] = useState<number | null>(null);
  const active = sel ?? peak;
  const shown = data[active];
  const dense = data.length > 12;

  if (!data.length || max === 0) {
    return (
      <div className={clsx('grid h-56 place-items-center text-muted text-sm', className)}>
        No usage recorded yet
      </div>
    );
  }

  return (
    <div className={clsx('relative', className)}>
      <div className="relative h-56">
        {shown && (
          <div
            className="pointer-events-none absolute inset-x-0 border-brand-400 border-t-2 border-dashed"
            style={{ bottom: `calc(${(shown.value / max) * 100}% * 0.86 + 1.75rem)` }}
          >
            <span className="absolute right-0 -top-6 font-medium text-brand-600 text-xs">
              {shown.title ?? shown.label}{' '}
              {shown.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              {unit}
            </span>
          </div>
        )}
        <div
          className={clsx(
            'absolute inset-0 flex items-end',
            dense ? 'gap-0.5 sm:gap-1.5' : 'gap-1.5 sm:gap-3',
          )}
        >
          {data.map((d, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: positional series
              key={i}
              type="button"
              onClick={() => setSel(i === sel ? null : i)}
              aria-label={`${d.title ?? d.label}: ${d.value} ${unit}`}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
            >
              <svg
                viewBox="0 0 10 100"
                preserveAspectRatio="none"
                className="w-full"
                style={{ height: `${Math.max(3, (d.value / max) * 86)}%` }}
                aria-hidden
              >
                <defs>
                  <linearGradient id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#3fbcec" />
                    <stop offset="1" stopColor="#128bc4" />
                  </linearGradient>
                </defs>
                <rect
                  width="10"
                  height="100"
                  rx="1.2"
                  fill={i === active ? `url(#${gid}-${i})` : '#e4f4fc'}
                />
              </svg>
              <span
                className={clsx(
                  'h-5 whitespace-nowrap text-xs',
                  i === active ? 'font-semibold text-brand-600' : 'text-muted',
                )}
              >
                {/* 30 daily bars don't fit 30 labels on a phone: label every 5th plus the selected one. */}
                {!dense || i === active || (i % 5 === 0 && Math.abs(i - active) > 1) ? d.label : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 border-line border-t" />
    </div>
  );
}

/** Area line chart for sensor history. */
export function LineChart({
  points,
  unit,
  className,
  formatX,
}: {
  points: { t: number; v: number }[];
  unit: string;
  className?: string;
  formatX: (t: number) => string;
}) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) {
    return (
      <div className={clsx('grid h-48 place-items-center text-muted text-sm', className)}>
        Not enough readings yet
      </div>
    );
  }
  const W = 600;
  const H = 200;
  const xs = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...vs), Math.max(...vs)];
  if (y1 - y0 < 1) {
    y0 -= 0.5;
    y1 += 0.5;
  }
  const pad = (y1 - y0) * 0.15;
  y0 -= pad;
  y1 += pad;
  const px = (t: number) => ((t - x0) / (x1 - x0 || 1)) * W;
  const py = (v: number) => H - ((v - y0) / (y1 - y0)) * H;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.t).toFixed(1)},${py(p.v).toFixed(1)}`).join('');
  const h = hover !== null ? points[hover] : points.at(-1)!;

  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-bold text-2xl text-brand-600">
          {h!.v.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          <span className="ml-1 font-medium text-base">{unit}</span>
        </span>
        <span className="text-muted text-xs">{formatX(h!.t)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-48 w-full touch-none"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = x0 + ((e.clientX - r.left) / r.width) * (x1 - x0);
          let best = 0;
          for (let i = 1; i < points.length; i++)
            if (Math.abs(points[i]!.t - t) < Math.abs(points[best]!.t - t)) best = i;
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`History chart, latest ${points.at(-1)!.v}${unit}`}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1ba8e0" stopOpacity=".28" />
            <stop offset="1" stopColor="#1ba8e0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${gid})`} />
        <path
          d={line}
          fill="none"
          stroke="#1ba8e0"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {hover !== null && (
          <line
            x1={px(h!.t)}
            x2={px(h!.t)}
            y1="0"
            y2={H}
            stroke="#7fd2f3"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-muted text-xs">
        <span>{formatX(x0)}</span>
        <span>{formatX(x1)}</span>
      </div>
    </div>
  );
}
