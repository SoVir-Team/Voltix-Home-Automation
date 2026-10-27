'use client';

import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

/**
 * Modal built on <dialog>: a bottom sheet on phones, a centered panel on larger screens.
 * Native dialog gives focus trapping, Escape to close and inert background for free.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; keyboard users get Esc from <dialog>
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className={clsx(
        'm-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-ink/40 backdrop:backdrop-blur-sm',
        'sm:m-auto sm:w-[calc(100%-2rem)]',
        wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col rounded-t-[2rem] bg-canvas shadow-2xl sm:rounded-[2rem]">
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" />
          <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2 sm:px-6 sm:pt-5">
            <h2 className="font-bold text-xl">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-10 place-items-center rounded-full bg-surface text-muted shadow-card hover:text-ink"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pt-2 pb-5 sm:px-6">{children}</div>
          {footer && (
            <div className="flex gap-3 border-line border-t bg-surface/70 px-5 pt-4 pb-safe sm:rounded-b-[2rem] sm:px-6 sm:pb-5">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation dialog for destructive actions. */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-full bg-tint font-semibold text-ink-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="h-11 flex-1 rounded-full bg-danger font-semibold text-white disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-ink-soft">{message}</p>
    </Sheet>
  );
}
