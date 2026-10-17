import { useInfiniteQuery } from '@tanstack/react-query';
import type { StudioRevisionItemsDto } from '@cinedrive/shared';
import { apiClient } from '../../../api/client';
import { studioKey } from '../../../hooks/useMusicStudio';
import { t } from '../../../i18n';
import { ErrorState } from '../../common/ErrorState';
import { StudioButton } from './StudioControls';

export function StudioHistoryItems({
  owner,
  playlistId,
  revisionId,
}: {
  owner: string;
  playlistId: string;
  revisionId: number;
}) {
  const query = useInfiniteQuery({
    queryKey: [...studioKey(owner), 'history', playlistId, revisionId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ signal, pageParam }) =>
      (
        await apiClient.get<StudioRevisionItemsDto>(
          `/music/studio/playlists/${encodeURIComponent(playlistId)}/history/${revisionId}/items`,
          { signal, params: { cursor: pageParam } },
        )
      ).data,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <p>{t.studio.loading}</p>;
  const items = query.data.pages.flatMap((page) => page.items);
  return (
    <div className="w-full space-y-2 text-sm">
      {!items.length && <p>{t.studio.orderOnly}</p>}
      {items.map((item) => (
        <p key={`${item.kind}:${item.occurrenceId}`}>
          {item.kind === 'added' ? '+' : '−'}{' '}
          {item.track
            ? `${item.track.title} · ${item.track.primaryArtist?.name ?? ''}`
            : t.studio.unavailableTrack}
        </p>
      ))}
      {query.hasNextPage && (
        <StudioButton
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t.studio.more}
        </StudioButton>
      )}
    </div>
  );
}
