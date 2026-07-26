import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t } from '../../i18n';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. Rendered in the header unless `hideTitle`. */
  title: React.ReactNode;
  /** Icon shown next to the title. */
  icon?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Set when the surrounding design already communicates the title visually. */
  hideTitle?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-3xl',
  xl: 'max-w-4xl',
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * The app's only dialog implementation. Every modal used to be an ad-hoc
 * `<div onClick={onClose}>` with no role, no focus management and — in most
 * cases — no Escape handling, so keyboard users could tab straight out of the
 * dialog into the page behind it.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  description,
  children,
  footer,
  size = 'md',
  hideTitle = false,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const getFocusable = useCallback(
    () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) || [],
      ).filter((element) => element.offsetParent !== null || element === document.activeElement),
    [],
  );

  // Remember where focus came from, move it into the dialog, and put it back on
  // close so the trigger does not lose its place in the tab order.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      const [first] = getFocusable();
      (first || dialogRef.current)?.focus();
    }, 0);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus?.();
    };
  }, [getFocusable, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [getFocusable, isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto p-4">
      {/* A real button so dismissing by clicking away is reachable without a
          mouse, rather than a div with a click handler. */}
      <button
        type="button"
        aria-label={t.common.close}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/80 backdrop-blur-md animate-fade-in"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative my-auto flex w-full ${SIZE_CLASSES[size]} flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl animate-scale-up`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 bg-zinc-900/60 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {icon}
            <div className="min-w-0">
              <h2
                id={titleId}
                className={`truncate font-display text-lg font-bold text-white ${
                  hideTitle ? 'sr-only' : ''
                }`}
              >
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-0.5 text-xs text-zinc-400">
                  {description}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="shrink-0 rounded-full bg-zinc-800 p-2 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <div className="border-t border-zinc-800 bg-zinc-900/40 px-6 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
};
