import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { EmptyState } from '../common/EmptyState';
import { ErrorState } from '../common/ErrorState';
import { t } from '../../i18n';

/** Keep loading, a failed request and a genuinely empty collection distinct. */
export function MusicCollectionState({
  loading,
  error,
  empty,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div
        className="cd-feedback flex items-center justify-center gap-3 text-zinc-400"
        role="status"
      >
        <Loader2 className="h-5 w-5 animate-spin" />
        {t.common.loading}
      </div>
    );
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (empty)
    return <EmptyState title={t.music.emptyTitle} description={t.music.emptyDescription} />;
  return <>{children}</>;
}
