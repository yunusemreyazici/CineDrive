import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { parseApiError } from '../../api/client';

interface ErrorStateProps {
  /** The error thrown by a query or mutation. */
  error: unknown;
  title?: string;
  /** Refetch callback — usually the `refetch` returned by useQuery. */
  onRetry?: () => void;
}

/**
 * A failed request must never be presented as an empty result. Pages render
 * this instead of their "nothing found" state whenever a query errors, so the
 * user can tell a server problem apart from an empty library.
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
  error,
  title = 'İçerik Yüklenemedi',
  onRetry,
}) => {
  const { message, requestId } = parseApiError(error);

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-12 text-center"
    >
      <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-400">
        <AlertTriangle className="h-10 w-10" />
      </div>
      <h3 className="mb-2 font-display text-xl font-semibold text-zinc-100">{title}</h3>
      <p className="mb-6 max-w-sm text-sm leading-relaxed text-zinc-400">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-brand-500/20 transition-all hover:bg-brand-500"
        >
          <RefreshCw className="h-4 w-4" />
          Tekrar Dene
        </button>
      )}
      {requestId && (
        <p className="mt-4 font-mono text-[11px] text-zinc-600">İstek No: {requestId}</p>
      )}
    </div>
  );
};
