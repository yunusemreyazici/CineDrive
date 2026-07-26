import { useCallback, useEffect, useMemo, useState } from 'react';
import { convertSrtToVtt } from '@cinedrive/shared';
import { usePlayerStore } from '../stores/usePlayerStore';
import { parseWebVttCues } from '../utils/subtitleCues';
import { normalizeSubtitleTrack } from '../utils/subtitleTracks';
import { t } from '../../../i18n';
import type { SubtitleTrackType } from '../types/player';
import type { SubtitleItemType } from '../../../types/media';

const SUBTITLE_PREFERENCE_STORAGE_KEY = 'cinedrive-subtitle-preference-v1';

const readStoredPreference = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Fall back to the server default.
    return null;
  }
};

interface UseSubtitleTracksOptions {
  /** Episode id when playing a series, otherwise the media id. */
  ownerId: string;
  /** Tracks the API reported for the current episode/movie. */
  serverSubtitles: (SubtitleItemType | SubtitleTrackType)[];
  onLoadError: (message: string) => void;
}

/**
 * Owns everything about subtitle *tracks* — merging server, uploaded and
 * OpenSubtitles sources, remembering the user's per-episode choice, and lazily
 * fetching cue text for tracks that are only available as a URL.
 */
export const useSubtitleTracks = ({
  ownerId,
  serverSubtitles,
  onLoadError,
}: UseSubtitleTracksOptions) => {
  const activeSubtitleId = usePlayerStore((state) => state.activeSubtitleId);
  const setActiveSubtitleId = usePlayerStore((state) => state.setActiveSubtitleId);

  const [customSubtitles, setCustomSubtitles] = useState<SubtitleTrackType[]>([]);
  const [loadedCues, setLoadedCues] = useState<Record<string, SubtitleTrackType['cues']>>({});
  /** Bumped whenever a native <track> finishes parsing, to re-sync cue times. */
  const [trackLoadVersion, setTrackLoadVersion] = useState(0);

  const preferenceKey = `${SUBTITLE_PREFERENCE_STORAGE_KEY}:${ownerId}`;

  const normalizedServerSubtitles = useMemo(
    () => serverSubtitles.map(normalizeSubtitleTrack),
    [serverSubtitles],
  );

  const availableSubtitles = useMemo(
    () =>
      Array.from(
        new Map(
          [...normalizedServerSubtitles, ...customSubtitles].map((subtitle) => [
            subtitle.id,
            subtitle,
          ]),
        ).values(),
      ),
    [customSubtitles, normalizedServerSubtitles],
  );

  const resolvedSubtitles = useMemo(
    () =>
      availableSubtitles.map((subtitle) => {
        const cues = loadedCues[subtitle.id];
        return cues?.length ? { ...subtitle, cues } : subtitle;
      }),
    [availableSubtitles, loadedCues],
  );

  const availabilityKey = availableSubtitles.map((subtitle) => subtitle.id).join('|');

  // Switching episode drops uploaded tracks and cached cues; they belong to the
  // previous file.
  useEffect(() => {
    setCustomSubtitles([]);
    setLoadedCues({});
  }, [ownerId]);

  const selectSubtitle = useCallback(
    (subtitleId: string | null) => {
      setActiveSubtitleId(subtitleId);
      try {
        window.localStorage.setItem(preferenceKey, subtitleId || 'off');
      } catch {
        // The in-memory selection still works when storage is unavailable.
      }
    },
    [preferenceKey, setActiveSubtitleId],
  );

  // Restore the remembered choice for this episode, else the server default.
  useEffect(() => {
    const stored = readStoredPreference(preferenceKey);

    if (stored === 'off') {
      setActiveSubtitleId(null);
      return;
    }
    if (stored && availableSubtitles.some((subtitle) => subtitle.id === stored)) {
      setActiveSubtitleId(stored);
      return;
    }

    const defaultSubtitle = availableSubtitles.find((subtitle) => subtitle.isDefault);
    setActiveSubtitleId(defaultSubtitle?.id || null);
    // `availabilityKey` is the stable identity of `availableSubtitles`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availabilityKey, preferenceKey, setActiveSubtitleId]);

  // Tracks stored server-side arrive as a URL only. Fetch the cue text the
  // first time one is selected so the styled overlay can render it.
  const pendingSubtitle = availableSubtitles.find(
    (subtitle) => subtitle.id === activeSubtitleId && !subtitle.cues?.length,
  );
  const pendingId = pendingSubtitle?.id;
  const pendingUrl = pendingSubtitle?.url;
  const isPendingLoaded = Boolean(pendingId && loadedCues[pendingId]?.length);

  useEffect(() => {
    if (!pendingId || !pendingUrl || isPendingLoaded) return;

    const controller = new AbortController();
    void fetch(pendingUrl, { credentials: 'include', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Subtitle fetch failed');
        return response.text();
      })
      .then((vttText) => {
        const cues = parseWebVttCues(vttText);
        if (!cues.length) throw new Error('Subtitle file has no valid cues');
        setLoadedCues((current) => ({ ...current, [pendingId]: cues }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        onLoadError(t.subtitles.storedLoadFailed);
      });

    return () => controller.abort();
  }, [isPendingLoaded, onLoadError, pendingId, pendingUrl]);

  const uploadCustomSubtitle = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const isSrt = file.name.toLowerCase().endsWith('.srt');
        const cues = parseWebVttCues(isSrt ? convertSrtToVtt(text) : text);
        if (!cues.length) throw new Error('Subtitle file has no valid cues');

        const customTrack: SubtitleTrackType = {
          id: `custom_${Date.now()}`,
          language: 'tr',
          label: `${file.name.replace(/\.[^/.]+$/, '')} (Yerel)`,
          isForced: false,
          isHearingImpaired: false,
          isDefault: false,
          cues,
        };

        setCustomSubtitles((prev) => [...prev, customTrack]);
        selectSubtitle(customTrack.id);
      } catch {
        onLoadError(t.subtitles.fileReadFailed);
      }
    },
    [onLoadError, selectSubtitle],
  );

  const addDownloadedSubtitle = useCallback(
    (track: SubtitleTrackType, vttContent: string) => {
      const cues = parseWebVttCues(vttContent);
      if (!cues.length) throw new Error('Downloaded subtitle has no valid cues');

      const downloaded: SubtitleTrackType = { ...track, cues };
      setCustomSubtitles((prev) => [
        ...prev.filter((subtitle) => subtitle.id !== downloaded.id),
        downloaded,
      ]);
      selectSubtitle(downloaded.id);
    },
    [selectSubtitle],
  );

  return {
    activeSubtitleId,
    availableSubtitles,
    resolvedSubtitles,
    trackLoadVersion,
    markTrackLoaded: useCallback(() => setTrackLoadVersion((version) => version + 1), []),
    selectSubtitle,
    uploadCustomSubtitle,
    addDownloadedSubtitle,
  };
};
