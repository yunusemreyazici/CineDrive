import { useEffect, useRef, useState } from 'react';
import type { MusicStudioDto, MusicTrackDto, StudioTrackLabelDto } from '@cinedrive/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../api/client';
import { useMusicTracksQuery } from '../../../hooks/useMusicApi';
import { useStudioProfile } from '../../../hooks/useMusicStudio';
import { useMusicPlayer } from '../../../features/music/MusicPlayerProvider';
import { ErrorState } from '../../common/ErrorState';
import { StudioPanel, StudioButton, studioInput, useStudioAction } from './StudioControls';
import { t, intlLocale } from '../../../i18n';

export function StudioProfile({ owner }: { owner: string }) {
  const profile = useStudioProfile(owner);
  if (profile.isError)
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <p>{t.studio.loading}</p>;
  return <ProfileEditor key={profile.data.revision} owner={owner} profile={profile.data} />;
}
function ProfileEditor({ owner, profile }: { owner: string; profile: MusicStudioDto }) {
  const player = useMusicPlayer();
  const action = useStudioAction(owner);
  const [name, setName] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<MusicTrackDto[]>([]);
  const [preferred, setPreferred] = useState('');
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<unknown>(null);
  const active = useRef(true);
  const restoreController = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      restoreController.current?.abort();
    };
  }, []);
  const results = useMusicTracksQuery({ q: search, pageSize: 20 });
  const linked = new Set(profile.families.flatMap((f) => f.trackIds));
  const save = (value: MusicStudioDto) =>
    void action.run({ path: '/music/studio/profile', method: 'put', body: value });
  const restore = async (id: string) => {
    if (restoreController.current) return;
    const controller = new AbortController();
    restoreController.current = controller;
    setRestoring(true);
    setRestoreError(null);
    try {
      const { data } = await apiClient.get<{
        tracks: MusicTrackDto[];
        index: number;
        position: number;
      }>(`/music/studio/sessions/${encodeURIComponent(id)}/tracks`, { signal: controller.signal });
      if (active.current && !controller.signal.aborted)
        player.playTracks(data.tracks, data.index, data.position);
    } catch (error) {
      if (active.current && !controller.signal.aborted) setRestoreError(error);
    } finally {
      if (active.current) setRestoring(false);
      restoreController.current = null;
    }
  };
  return (
    <div className="space-y-6">
      {action.feedback}
      {restoreError != null && <ErrorState error={restoreError} />}
      <StudioPanel>
        <h2 className="text-xl font-bold">{t.studio.family}</h2>
        <p className="text-sm text-zinc-400">{t.studio.familyHint}</p>
        <fieldset disabled={action.busy} className="space-y-4">
          {profile.families.map((family) => (
            <div
              className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-3"
              key={family.id}
            >
              <strong>{family.name}</strong>
              <StudioButton
                aria-expanded={expandedFamily === family.id}
                onClick={() => setExpandedFamily(expandedFamily === family.id ? null : family.id)}
              >
                {t.studio.preferred}
              </StudioButton>
              {expandedFamily === family.id && (
                <FamilyVersions
                  owner={owner}
                  family={family}
                  onChange={(id) =>
                    save({
                      ...profile,
                      families: profile.families.map((f) =>
                        f.id === family.id ? { ...f, preferredTrackId: id } : f,
                      ),
                    })
                  }
                />
              )}
              <StudioButton
                onClick={() =>
                  save({ ...profile, families: profile.families.filter((f) => f.id !== family.id) })
                }
              >
                {t.studio.unlink}
              </StudioButton>
            </div>
          ))}
          {!profile.families.length && <p>{t.studio.empty}</p>}
          <label className="block">
            {t.studio.name}
            <input
              className={`${studioInput} ml-2`}
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            {t.studio.search}
            <input
              className={`${studioInput} ml-2`}
              value={search}
              maxLength={200}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {results.isError && <ErrorState error={results.error} />}
          {search.length >= 2 &&
            results.data?.tracks
              .filter((track) => !linked.has(track.id) && !chosen.some((c) => c.id === track.id))
              .map((track) => (
                <div key={track.id} className="flex justify-between">
                  <span>
                    {track.title} · {track.album?.title}
                  </span>
                  <StudioButton
                    disabled={chosen.length >= 30}
                    onClick={() => {
                      setChosen([...chosen, track]);
                      if (!preferred) setPreferred(track.id);
                      if (!name) setName(track.title);
                    }}
                  >
                    {t.studio.add}
                  </StudioButton>
                </div>
              ))}
          {chosen.map((track) => (
            <label key={track.id} className="flex items-center gap-3">
              <input
                type="radio"
                name="preferred-recording"
                checked={preferred === track.id}
                onChange={() => setPreferred(track.id)}
              />
              {track.title} · {track.album?.title}
              <StudioButton
                onClick={() => {
                  setChosen(chosen.filter((c) => c.id !== track.id));
                  if (preferred === track.id) setPreferred('');
                }}
              >
                {t.studio.remove}
              </StudioButton>
            </label>
          ))}
          <StudioButton
            disabled={
              chosen.length < 2 || !preferred || !name.trim() || profile.families.length >= 200
            }
            onClick={() =>
              save({
                ...profile,
                families: [
                  ...profile.families,
                  {
                    id: crypto.randomUUID(),
                    name: name.trim(),
                    trackIds: chosen.map((c) => c.id),
                    preferredTrackId: preferred,
                  },
                ],
              })
            }
          >
            {t.studio.save}
          </StudioButton>
        </fieldset>
      </StudioPanel>
      <StudioPanel>
        <h2 className="text-xl font-bold">{t.studio.sessions}</h2>
        <fieldset disabled={action.busy || restoring} className="space-y-4">
          <label>
            {t.studio.name}{' '}
            <input
              className={studioInput}
              value={sessionName}
              maxLength={160}
              onChange={(e) => setSessionName(e.target.value)}
            />
          </label>
          <StudioButton
            disabled={
              !sessionName.trim() ||
              !player.queue.length ||
              player.queue.length > 500 ||
              profile.sessions.length >= 30 ||
              !player.currentQueueItemId
            }
            onClick={() => {
              const index = player.queue.findIndex(
                (entry) => entry.id === player.currentQueueItemId,
              );
              if (index < 0) return;
              save({
                ...profile,
                sessions: [
                  ...profile.sessions,
                  {
                    id: crypto.randomUUID(),
                    name: sessionName.trim(),
                    trackIds: player.queue.map((entry) => entry.trackId),
                    index,
                    position: Number.isFinite(player.position)
                      ? Math.min(86400, Math.max(0, player.position))
                      : 0,
                    savedAt: new Date().toISOString(),
                  },
                ],
              });
            }}
          >
            {t.studio.saveSession}
          </StudioButton>
          {!profile.sessions.length && <p>{t.studio.empty}</p>}
          {profile.sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-3"
            >
              <span>
                {session.name} · {session.trackIds.length} ·{' '}
                {new Date(session.savedAt).toLocaleString(intlLocale)}
              </span>
              <div className="flex gap-2">
                <StudioButton onClick={() => void restore(session.id)}>
                  {t.studio.resume}
                </StudioButton>
                <StudioButton
                  onClick={() =>
                    save({
                      ...profile,
                      sessions: profile.sessions.filter((s) => s.id !== session.id),
                    })
                  }
                >
                  {t.studio.delete}
                </StudioButton>
              </div>
            </div>
          ))}
        </fieldset>
      </StudioPanel>
    </div>
  );
}
function FamilyVersions({
  owner,
  family,
  onChange,
}: {
  owner: string;
  family: MusicStudioDto['families'][number];
  onChange: (id: string) => void;
}) {
  // Hydrate only the expanded family (at most 30 lightweight labels), never all saved sessions.
  const query = useQuery({
    queryKey: ['music-studio', owner, 'family', family.id],
    retry: false,
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<{ tracks: StudioTrackLabelDto[] }>(
          `/music/studio/families/${family.id}/tracks`,
          { signal },
        )
      ).data,
  });
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <p>{t.studio.loading}</p>;
  const byId = new Map(query.data.tracks.map((track) => [track.id, track]));
  return (
    <label>
      {t.studio.preferred}{' '}
      <select
        className={studioInput}
        value={family.preferredTrackId}
        onChange={(e) => onChange(e.target.value)}
      >
        {family.trackIds.map((id) => {
          const track = byId.get(id);
          return (
            <option key={id} value={id} disabled={!track}>
              {track
                ? `${track.title} · ${track.album?.title ?? track.primaryArtist?.name ?? ''}`
                : t.studio.unavailableTrack}
            </option>
          );
        })}
      </select>
    </label>
  );
}
