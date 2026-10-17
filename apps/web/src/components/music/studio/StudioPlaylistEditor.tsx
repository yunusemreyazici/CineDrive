import { useState } from 'react';
import type { StudioPlaylistSummaryDto, StudioWorkshopDto } from '@cinedrive/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import {
  useStudioDetail,
  useStudioHistory,
  useStudioTrackSearch,
} from '../../../hooks/useMusicStudio';
import { useMusicPlayer } from '../../../features/music/MusicPlayerProvider';
import { ErrorState } from '../../common/ErrorState';
import { t, intlLocale } from '../../../i18n';
import { StudioPanel, StudioButton, studioInput, useStudioAction } from './StudioControls';
import { StudioHistoryItems } from './StudioHistoryItems';

export function StudioPlaylistEditor({
  owner,
  id,
  lists,
}: {
  owner: string;
  id: string;
  lists: StudioPlaylistSummaryDto[];
}) {
  const detail = useStudioDetail(owner, id);
  if (detail.isError)
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <p role="status">{t.studio.loading}</p>;
  // Reset selections on authoritative version changes, not on an arbitrary render.
  return (
    <Editor
      key={`${id}:${detail.data.version}`}
      owner={owner}
      data={detail.data}
      lists={lists}
      refresh={() => void detail.refetch()}
    />
  );
}
function Editor({
  owner,
  data,
  lists,
  refresh,
}: {
  owner: string;
  data: StudioWorkshopDto;
  lists: StudioPlaylistSummaryDto[];
  refresh: () => void;
}) {
  const action = useStudioAction(owner);
  const player = useMusicPlayer();
  const history = useStudioHistory(owner, data.playlist.id);
  const [selected, setSelected] = useState(new Set<string>());
  const [expandedRevision, setExpandedRevision] = useState<number | null>(null);
  const [destination, setDestination] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'listener'>('editor');
  const [search, setSearch] = useState('');
  const results = useStudioTrackSearch(owner, search);
  const items = data.playlist.items ?? [];
  const path = `/music/studio/playlists/${encodeURIComponent(data.playlist.id)}`;
  const target = useQuery({
    queryKey: ['music-studio', owner, 'playlist', destination],
    enabled: !!destination,
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<StudioWorkshopDto>(
          `/music/studio/playlists/${encodeURIComponent(destination)}`,
          { signal },
        )
      ).data,
    retry: false,
  });
  const save = (next: Array<{ id: string; trackId: string }>) =>
    void action.run({
      path: path + '/items',
      method: 'put',
      body: { operationId: crypto.randomUUID(), version: data.version, items: next },
    });
  const occurrences = items.map((i) => ({ id: i.id, trackId: i.track.id }));
  const transfer = (move: boolean) => {
    if (target.data)
      void action.run({
        path: path + '/transfer',
        body: {
          operationId: crypto.randomUUID(),
          version: data.version,
          targetId: destination,
          targetVersion: target.data.version,
          itemIds: items.filter((i) => selected.has(i.id)).map((i) => i.id),
          move,
        },
      });
  };
  return (
    <StudioPanel>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">{data.playlist.name}</h2>
        <StudioButton onClick={refresh}>{t.studio.refresh}</StudioButton>
      </header>
      <p className="text-sm text-zinc-400">{t.studio.accessHint}</p>
      {!!data.unavailableCount && <p role="status">{t.studio.hidden(data.unavailableCount)}</p>}
      {action.feedback}
      <fieldset disabled={action.busy} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <StudioButton
            disabled={!items.length}
            onClick={() => player.playTracks(items.map((i) => i.track))}
          >
            {t.studio.play}
          </StudioButton>
          <StudioButton onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
            {t.studio.selectAll}
          </StudioButton>
          <StudioButton
            onClick={() => {
              const seen = new Set<string>();
              setSelected(
                new Set(
                  items
                    .filter((i) => {
                      const duplicate = seen.has(i.track.id);
                      seen.add(i.track.id);
                      return duplicate;
                    })
                    .map((i) => i.id),
                ),
              );
            }}
          >
            {t.studio.duplicates}
          </StudioButton>
          <StudioButton
            disabled={!data.canEdit || !selected.size}
            onClick={() => save(occurrences.filter((i) => !selected.has(i.id)))}
          >
            {t.studio.remove}
          </StudioButton>
          <StudioButton
            disabled={!data.canEdit || selected.size < 2}
            onClick={() => {
              const ordered = items
                .filter((i) => selected.has(i.id))
                .sort((a, b) => a.track.title.localeCompare(b.track.title, intlLocale))
                .map((i) => ({ id: i.id, trackId: i.track.id }));
              let index = 0;
              save(occurrences.map((i) => (selected.has(i.id) ? ordered[index++]! : i)));
            }}
          >
            {t.studio.sort}
          </StudioButton>
        </div>
        <p aria-live="polite">{t.studio.selected(selected.size)}</p>
        <div className="flex flex-wrap gap-2">
          <label>
            {t.studio.destination}{' '}
            <select
              className={studioInput}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">—</option>
              {lists
                .filter((p) => p.id !== data.playlist.id && !p.pending && p.role !== 'listener')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <StudioButton
            disabled={!target.data?.canEdit || !selected.size || selected.size > 500}
            onClick={() => transfer(false)}
          >
            {t.studio.copy}
          </StudioButton>
          <StudioButton
            disabled={
              !data.canEdit || !target.data?.canEdit || !selected.size || selected.size > 500
            }
            onClick={() => transfer(true)}
          >
            {t.studio.move}
          </StudioButton>
        </div>
        {target.isError && <ErrorState error={target.error} />}
        {!items.length && <p>{t.studio.empty}</p>}
        <div className="max-h-[32rem] overflow-auto rounded-xl border border-white/10">
          {items.map((item) => (
            <label
              key={item.id}
              htmlFor={`studio-item-${item.id}`}
              aria-label={`${item.track.title} · ${item.track.primaryArtist?.name ?? ''}`}
              className="flex cursor-pointer items-center gap-3 border-b border-white/5 p-3 hover:bg-white/5"
            >
              <input
                id={`studio-item-${item.id}`}
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() =>
                  setSelected((old) => {
                    const next = new Set(old);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
              />
              <span className="min-w-0">
                <span className="block truncate">{item.track.title}</span>
                <span className="text-xs text-zinc-400">{item.track.primaryArtist?.name}</span>
              </span>
            </label>
          ))}
        </div>
        {data.canEdit && (
          <div className="space-y-2">
            <label className="block">
              {t.studio.search}
              <input
                className={`${studioInput} mt-1 w-full`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={200}
              />
            </label>
            {results.isError && <ErrorState error={results.error} />}
            {search.trim().length >= 2 && results.isPending && (
              <p role="status">{t.studio.loading}</p>
            )}
            {search.trim().length >= 2 && results.isSuccess && !results.data.tracks.length && (
              <p role="status">{t.studio.noSearchMatches}</p>
            )}
            {results.data && results.data.pagination.total > 20 && (
              <p className="text-sm text-zinc-400">{t.studio.refineSearch}</p>
            )}
            {search.trim().length >= 2 &&
              results.data?.tracks.map((track) => (
                <div key={track.id} className="flex justify-between gap-3">
                  <span>
                    {track.title} · {track.primaryArtist?.name}
                  </span>
                  <StudioButton
                    disabled={items.length >= 2000}
                    onClick={() =>
                      save([...occurrences, { id: crypto.randomUUID(), trackId: track.id }])
                    }
                  >
                    {t.studio.add}
                  </StudioButton>
                </div>
              ))}
          </div>
        )}
        {data.role === 'owner' && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">{t.studio.member}</h3>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run({ path: path + '/invite', body: { email, role } }, () =>
                  setEmail(''),
                );
              }}
            >
              <input
                aria-label={t.studio.email}
                placeholder={t.studio.email}
                className={studioInput}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                maxLength={254}
              />
              <select
                aria-label={t.studio.member}
                className={studioInput}
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="editor">{t.studio.editor}</option>
                <option value="listener">{t.studio.listener}</option>
              </select>
              <StudioButton type="submit">{t.studio.invite}</StudioButton>
            </form>
            {data.members.map((m) => (
              <div key={m.userId} className="flex justify-between gap-3">
                <span>
                  {m.name} · {m.role === 'editor' ? t.studio.editor : t.studio.listener}{' '}
                  {!m.accepted && `· ${t.studio.pending}`}
                </span>
                <StudioButton
                  onClick={() =>
                    void action.run({
                      path: `${path}/members/${encodeURIComponent(m.userId)}`,
                      method: 'delete',
                    })
                  }
                >
                  {t.studio.revoke}
                </StudioButton>
              </div>
            ))}
          </div>
        )}
      </fieldset>
      <h3 className="text-lg font-semibold">{t.studio.history}</h3>
      <p className="text-sm text-zinc-400">{t.studio.historyHint}</p>
      {history.isPending && <p>{t.studio.loading}</p>}
      {history.isError && (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      )}
      {history.data?.pages
        .flatMap((page) => page.entries)
        .map((entry) => (
          <div
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-3"
          >
            <div>
              <p>
                {entry.actorName ?? t.studio.unknownActor} ·{' '}
                {t.studio.kind[entry.kind as keyof typeof t.studio.kind] ?? entry.kind}
              </p>
              <p className="text-xs text-zinc-400">
                {new Date(entry.createdAt).toLocaleString(intlLocale)} ·{' '}
                {t.studio.addedRemoved(entry.added, entry.removed)}
              </p>
            </div>
            <StudioButton
              aria-expanded={expandedRevision === entry.id}
              onClick={() => setExpandedRevision(expandedRevision === entry.id ? null : entry.id)}
            >
              {t.studio.details}
            </StudioButton>
            {entry.canRestore && (
              <StudioButton
                disabled={action.busy}
                onClick={() => {
                  if (window.confirm(t.studio.restoreConfirm))
                    void action.run({
                      path: `${path}/history/${entry.id}/restore`,
                      body: { operationId: crypto.randomUUID(), version: data.version },
                    });
                }}
              >
                {t.studio.restore}
              </StudioButton>
            )}
            {expandedRevision === entry.id && (
              <StudioHistoryItems
                owner={owner}
                playlistId={data.playlist.id}
                revisionId={entry.id}
              />
            )}
          </div>
        ))}
      {history.hasNextPage && (
        <StudioButton
          onClick={() => void history.fetchNextPage()}
          disabled={history.isFetchingNextPage}
        >
          {t.studio.more}
        </StudioButton>
      )}
    </StudioPanel>
  );
}
