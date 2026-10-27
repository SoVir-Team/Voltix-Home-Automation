'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

/** Read-only value with a copy button (board credentials, API keys, server address). */
export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1.5 font-semibold text-ink-soft text-sm">{label}</p>
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-tint py-1.5 pr-1.5 pl-4">
        <code
          className={
            secret
              ? 'min-w-0 flex-1 break-all font-mono text-sm'
              : 'min-w-0 flex-1 truncate font-mono text-sm'
          }
        >
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error('Copy failed — select the text and copy it manually');
            }
          }}
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-brand-600 shadow-card active:scale-95"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}
