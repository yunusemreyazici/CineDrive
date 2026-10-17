import { useState } from 'react';
import { useSessionQuery } from '../hooks/useApi';
import { useStudioChanges, useStudioDirectory } from '../hooks/useMusicStudio';
import { ErrorState } from '../components/common/ErrorState';
import {
  StudioPanel,
  StudioButton,
  studioInput,
  useStudioAction,
} from '../components/music/studio/StudioControls';
import { StudioPlaylistEditor } from '../components/music/studio/StudioPlaylistEditor';
import { StudioProfile } from '../components/music/studio/StudioProfile';
import { StudioHealth } from '../components/music/studio/StudioHealth';
import { t } from '../i18n';

export function MusicStudioPage() {
  const session = useSessionQuery();
  if (!session.data?.authenticated || !session.data.user) return null;
  return <Studio key={session.data.user.id} owner={session.data.user.id} />;
}
function Studio({ owner }: { owner: string }) {
  const [tab, setTab] = useState<'lists' | 'profile' | 'health'>('lists');
  useStudioChanges(owner);
  return (
    <div className="mx-auto max-w-7xl space-y-7 p-4 pb-32 md:p-8 md:pb-32">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-brand-400">CineDrive</p>
        <h1 className="mt-2 font-display text-4xl font-bold">{t.studio.title}</h1>
        <p className="mt-3 text-zinc-400">{t.studio.intro}</p>
      </header>
      <nav aria-label={t.studio.title} className="flex flex-wrap gap-2">
        {(['lists', 'profile', 'health'] as const).map((key) => (
          <StudioButton
            key={key}
            aria-pressed={tab === key}
            className={tab === key ? 'bg-brand-600/30' : ''}
            onClick={() => setTab(key)}
          >
            {t.studio[key]}
          </StudioButton>
        ))}
      </nav>
      {tab === 'lists' && <Directory owner={owner} />}
      {tab === 'profile' && <StudioProfile owner={owner} />}
      {tab === 'health' && <StudioHealth owner={owner} />}
    </div>
  );
}
function Directory({ owner }: { owner: string }) {
  const directory = useStudioDirectory(owner);
  const action = useStudioAction(owner);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const lists = [
    ...new Map(
      (directory.data?.pages.flatMap((page) => page.playlists) ?? []).map((p) => [p.id, p]),
    ).values(),
  ];
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[300px_1fr]">
      <StudioPanel>
        <h2 className="text-xl font-semibold">{t.studio.lists}</h2>
        {action.feedback}
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim())
              void action.run(
                {
                  path: '/music/studio/playlists',
                  body: { operationId: crypto.randomUUID(), name: name.trim() },
                },
                () => setName(''),
              );
          }}
        >
          <label className="block">
            {t.studio.name}
            <input
              className={`${studioInput} mt-1 w-full`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              disabled={action.busy}
            />
          </label>
          <StudioButton type="submit" disabled={!name.trim() || action.busy}>
            {t.studio.create}
          </StudioButton>
        </form>
        {directory.isPending && <p>{t.studio.loading}</p>}
        {directory.isError && (
          <ErrorState error={directory.error} onRetry={() => void directory.refetch()} />
        )}
        {!directory.isPending && !directory.isError && !lists.length && <p>{t.studio.empty}</p>}
        {lists.map((list) => (
          <div key={list.id} className="space-y-2 border-t border-white/10 pt-3">
            {list.pending ? (
              <>
                <p>
                  {list.name} · {t.studio.pending}
                </p>
                <StudioButton
                  disabled={action.busy}
                  onClick={() =>
                    void action.run({
                      path: `/music/studio/playlists/${encodeURIComponent(list.id)}/accept`,
                    })
                  }
                >
                  {t.studio.accept}
                </StudioButton>
              </>
            ) : (
              <StudioButton
                aria-pressed={selected === list.id}
                onClick={() => setSelected(list.id)}
              >
                {list.name} · {t.studio[list.role]}
              </StudioButton>
            )}
            {list.role !== 'owner' && (
              <StudioButton
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    {
                      path: `/music/studio/playlists/${encodeURIComponent(list.id)}/members/${encodeURIComponent(owner)}`,
                      method: 'delete',
                    },
                    () => {
                      if (selected === list.id) setSelected('');
                    },
                  )
                }
              >
                {list.pending ? t.studio.decline : t.studio.leave}
              </StudioButton>
            )}
          </div>
        ))}
        {directory.hasNextPage && (
          <StudioButton
            disabled={directory.isFetchingNextPage}
            onClick={() => void directory.fetchNextPage()}
          >
            {t.studio.more}
          </StudioButton>
        )}
      </StudioPanel>
      <div>
        {selected ? (
          <StudioPlaylistEditor key={selected} owner={owner} id={selected} lists={lists} />
        ) : (
          <StudioPanel>
            <p>{t.studio.accessHint}</p>
          </StudioPanel>
        )}
      </div>
    </div>
  );
}
