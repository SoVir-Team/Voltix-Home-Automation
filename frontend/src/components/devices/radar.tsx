import { Icon } from '@/components/icon';

// Fixed spots around the radar (percent of the box) so found devices don't jump around.
const spots = [
  [52, 8],
  [12, 40],
  [86, 60],
  [50, 84],
  [80, 20],
  [18, 74],
  [30, 14],
  [72, 86],
] as const;

/** "Add Device" radar: a sweeping beam, with found devices popping up as chips. */
export function Radar({
  found,
  scanning,
}: {
  found: { id: string; name: string; icon: string }[];
  scanning: boolean;
}) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[22rem]">
      <div className="absolute inset-[6%] rounded-full bg-brand-100/60 ring-1 ring-brand-200" />
      <div className="absolute inset-[18%] rounded-full ring-1 ring-brand-200" />
      <div className="absolute inset-[32%] rounded-full ring-1 ring-brand-200" />
      {scanning && (
        <>
          <div className="absolute inset-[6%] animate-pulse-ring rounded-full ring-2 ring-brand-300/60" />
          <div
            className="absolute inset-[6%] animate-sweep rounded-full motion-reduce:hidden"
            style={{ background: 'conic-gradient(from 0deg, rgba(27,168,224,.45), rgba(27,168,224,0) 22%)' }}
          />
        </>
      )}
      <div className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500 shadow-float" />
      {found.slice(0, spots.length).map((d, i) => {
        const [x, y] = spots[i]!;
        return (
          <div
            key={d.id}
            className="absolute flex max-w-[45%] -translate-x-1/2 -translate-y-1/2 animate-pop items-center gap-2 rounded-2xl bg-surface px-3 py-2 shadow-card"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <Icon name={d.icon} className="size-5 shrink-0 text-ink" />
            <span className="truncate text-sm">{d.name}</span>
          </div>
        );
      })}
      {found.length > spots.length && (
        <span className="absolute right-0 bottom-0 rounded-full bg-surface px-3 py-1 font-semibold text-brand-600 text-sm shadow-card">
          +{found.length - spots.length} more
        </span>
      )}
    </div>
  );
}
