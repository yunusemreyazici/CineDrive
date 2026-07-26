import React, { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { useToastStore, type Toast, type ToastVariant } from '../../stores/useToastStore';
import { t } from '../../i18n';

const VARIANT_STYLES: Record<ToastVariant, { wrapper: string; icon: React.ReactNode }> = {
  success: {
    wrapper: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />,
  },
  error: {
    wrapper: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    icon: <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />,
  },
  info: {
    wrapper: 'border-brand-500/30 bg-brand-500/10 text-brand-100',
    icon: <Info className="h-4 w-4 shrink-0 text-brand-400" />,
  },
};

const ToastCard: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  const styles = VARIANT_STYLES[toast.variant];

  useEffect(() => {
    if (toast.durationMs <= 0) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.durationMs, toast.id]);

  return (
    <div
      className={`pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-2xl shadow-black/40 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200 ${styles.wrapper}`}
    >
      {styles.icon}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold leading-snug">{toast.message}</p>
        {toast.detail && (
          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">{toast.detail}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t.toast.dismiss}
        className="shrink-0 rounded-lg p-0.5 text-zinc-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

/**
 * Single place where transient feedback is rendered. Pages used to each keep
 * their own `subMessage` state and inline banner; they now call
 * `toast.success(...)` / `toast.fromError(...)` instead.
 */
export const ToastViewport: React.FC = () => {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      // Assertive would interrupt screen readers mid-sentence; these are
      // confirmations and recoverable errors, not alarms.
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[10000] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </div>
  );
};
