import type { ReactNode } from 'react';
import { Bolt, Logo } from '@/components/brand';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-gradient p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/95">
            <Bolt className="size-8" />
          </span>
          <span className="font-extrabold text-2xl tracking-[0.22em]">VOLTIX</span>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="font-semibold text-5xl leading-[1.1]">Set up devices, take control.</h1>
          <p className="mt-4 text-lg text-white/85">
            Lights, fans, ACs and sensors in every room, controlled from anywhere and shared with your family.
          </p>
        </div>
        <p className="text-sm text-white/70">© {new Date().getFullYear()} Voltix</p>
        <div className="absolute -right-32 -bottom-32 size-[34rem] rounded-full border border-white/20" />
        <div className="absolute -right-10 -bottom-10 size-[22rem] rounded-full border border-white/15" />
        <Bolt className="absolute right-16 bottom-24 size-56 opacity-20 mix-blend-overlay" />
      </aside>
      <main className="flex flex-col items-center justify-center px-5 pt-safe pb-safe sm:px-8">
        <div className="w-full max-w-md py-10">
          <Logo className="mb-10 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
