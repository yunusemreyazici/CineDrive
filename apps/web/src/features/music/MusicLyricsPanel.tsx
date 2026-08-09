import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Languages, Pencil, Save, TimerReset, Upload, Wand2, X } from 'lucide-react';
import {
  useMusicLyricsQuery,
  useUpdateMusicLyricsMutation,
  useWriteLyricsSidecarMutation,
  useAutoTranslateLyricsMutation,
  useAlignLyricsMutation,
  useImportLyricsRevisionMutation,
  useApplyLyricsRevisionMutation,
} from '../../hooks/useMusicApi';
import { t } from '../../i18n';
import { useMusicPlayer } from './MusicPlayerProvider';

interface Props {
  trackId: string;
  position: number;
  onSeek: (seconds: number) => void;
  onClose: () => void;
}

type LyricsMode = 'original' | 'translation' | 'romanization';

const KaraokeText: React.FC<{ line: { timeMs: number | null; text: string; words?: Array<{ timeMs: number; text: string }> }; nextTimeMs?: number | null; positionMs: number }> = ({ line, nextTimeMs, positionMs }) => {
  const explicit = line.words?.length ? line.words : null;
  const words = explicit || line.text.split(/\s+/).filter(Boolean).map((text, index, all) => ({
    text,
    timeMs: (line.timeMs || 0) + ((nextTimeMs || (line.timeMs || 0) + 4000) - (line.timeMs || 0)) * index / Math.max(1, all.length),
  }));
  return <>{words.map((word, index) => <React.Fragment key={`${word.timeMs}-${index}`}><span className={positionMs >= word.timeMs ? 'text-white' : 'text-white/30'}>{word.text}</span>{index < words.length - 1 ? ' ' : ''}</React.Fragment>)}</>;
};

export const MusicLyricsPanel: React.FC<Props> = ({ trackId, position, onSeek, onClose }) => {
  const query = useMusicLyricsQuery(trackId);
  const updateLyrics = useUpdateMusicLyricsMutation();
  const writeSidecar = useWriteLyricsSidecarMutation();
  const autoTranslate = useAutoTranslateLyricsMutation();
  const alignLyrics = useAlignLyricsMutation();
  const importRevision = useImportLyricsRevisionMutation();
  const applyRevision = useApplyLyricsRevisionMutation();
  const track = useMusicPlayer().currentTrack;
  const activeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const communityFileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<LyricsMode>('original');
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [translatedContent, setTranslatedContent] = useState('');
  const [romanizedContent, setRomanizedContent] = useState('');
  const [offsetMs, setOffsetMs] = useState(0);
  const [language, setLanguage] = useState('');
  const [translationLanguage, setTranslationLanguage] = useState('');
  const [selectedTranslation, setSelectedTranslation] = useState('');

  const lines = useMemo(() => {
    if (!query.data) return [];
    if (mode === 'translation') {
      const translation = query.data.translations?.find((item) => item.language === selectedTranslation) || query.data.translations?.[0];
      return translation?.lines || query.data.translatedLines || [];
    }
    if (mode === 'romanization') return query.data.romanizedLines || [];
    return query.data.lines;
  }, [mode, query.data, selectedTranslation]);

  const activeIndex = useMemo(() => {
    if (!query.data?.isSynced) return -1;
    const positionMs = position * 1000;
    let result = -1;
    lines.forEach((line, index) => {
      if (line.timeMs !== null && line.timeMs <= positionMs) result = index;
    });
    return result;
  }, [lines, position, query.data?.isSynced]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  const openEditor = () => {
    setContent(query.data?.content || '');
    setTranslatedContent(query.data?.translatedContent || '');
    setRomanizedContent(query.data?.romanizedContent || '');
    setOffsetMs(query.data?.offsetMs || 0);
    setLanguage(query.data?.language || '');
    setTranslationLanguage(query.data?.translationLanguage || '');
    setEditing(true);
  };

  const save = () => {
    const withoutOffset = content.replace(/^\[offset:[+-]?\d+\]\s*/im, '').trim();
    const adjusted = offsetMs ? `[offset:${offsetMs}]\n${withoutOffset}` : withoutOffset;
    updateLyrics.mutate(
      {
        trackId,
        content: adjusted,
        translatedContent: translatedContent.trim() || null,
        romanizedContent: romanizedContent.trim() || null,
        language: language.trim() || null,
        translationLanguage: translationLanguage.trim() || null,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const stampNextUntimedLine = () => {
    const rows = content.split('\n');
    const index = rows.findIndex((row) => row.trim() && !/^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(row.trim()));
    if (index < 0) return;
    const milliseconds = Math.max(0, Math.round(position * 1000));
    const minutes = Math.floor(milliseconds / 60_000);
    const seconds = Math.floor((milliseconds % 60_000) / 1000);
    const centiseconds = Math.floor((milliseconds % 1000) / 10);
    rows[index] = `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}] ${rows[index]!.trim()}`;
    setContent(rows.join('\n'));
  };

  return (
    <aside
      aria-label={t.music.lyrics}
      className="fixed inset-0 z-[80] isolate flex flex-col overflow-hidden bg-[#090a0b] shadow-2xl"
    >
      {track?.artworkUrl && (
        <img
          src={track.artworkUrl}
          alt=""
          className="pointer-events-none absolute inset-[-15%] -z-20 h-[130%] w-[130%] scale-110 object-cover opacity-35 blur-[110px] saturate-150"
        />
      )}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/35 via-[#090a0b]/75 to-[#070809]" />
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 backdrop-blur-xl sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-full bg-white/10 p-2">
            <FileText className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold">{t.music.lyrics}</h2>
            <p className="truncate text-xs text-white/45">
              {track?.title} {track?.primaryArtist ? `· ${track.primaryArtist.name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={openEditor}
            aria-label={t.music.editLyrics}
            className="rounded-full p-3 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <Pencil className="h-4 w-4" />
          </button>
          {query.data && (
            <a
              href={`/api/music/tracks/${trackId}/lyrics/lrc`}
              download
              aria-label={t.music.downloadLrc}
              className="rounded-full p-3 text-white/60 hover:bg-white/10 hover:text-white"
            >
              <Download className="h-4 w-4" />
            </a>
          )}
          <button
            onClick={onClose}
            aria-label={t.common.close}
            className="rounded-full border border-white/10 bg-black/20 p-3 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {query.data &&
        ((query.data.translations?.length || 0) > 0 ||
          (query.data.translatedLines?.length || 0) > 0 ||
          (query.data.romanizedLines?.length || 0) > 0) && (
          <div className="flex justify-center gap-1 border-b border-white/10 p-2">
            {(['original', 'translation', 'romanization'] as const).map((item) => {
              const disabled =
                (item === 'translation' && !query.data?.translations?.length && !query.data?.translatedLines?.length) ||
                (item === 'romanization' && !query.data?.romanizedLines?.length);
              return (
                <button
                  key={item}
                  disabled={disabled}
                  onClick={() => setMode(item)}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition ${mode === item ? 'bg-white text-black' : 'text-white/45 hover:bg-white/10 hover:text-white'} disabled:hidden`}
                >
                  {t.music.lyricsModes[item]}
                </button>
              );
            })}
          </div>
        )}

      <div
        className="mx-auto min-h-48 w-full max-w-4xl flex-1 overflow-y-auto px-6 py-[28vh] sm:px-12"
        aria-live="polite"
      >
        {query.isLoading ? (
          <div className="mx-auto max-w-2xl space-y-6">
            <p className="mb-8 text-center text-sm font-medium text-white/45">
              {t.music.findingLyrics}
            </p>
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-8 animate-pulse rounded-xl bg-white/[0.06]" />
            ))}
          </div>
        ) : !query.data || lines.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <div className="mb-5 rounded-full border border-white/10 bg-white/[0.04] p-5">
              <FileText className="h-8 w-8 text-white/35" />
            </div>
            <p className="font-display text-xl font-semibold text-white">{t.music.noLyrics}</p>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/40">{t.music.lyricsHint}</p>
            <button
              onClick={openEditor}
              className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black"
            >
              {t.music.importOrEditLrc}
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {lines.map((line, index) =>
              query.data?.isSynced && line.timeMs !== null ? (
                <button
                  key={`${line.timeMs}-${index}`}
                  ref={index === activeIndex ? activeRef : undefined}
                  onClick={() => onSeek(line.timeMs! / 1000)}
                  className={`block w-full rounded-2xl px-4 py-2 text-left font-display text-2xl font-semibold leading-snug transition duration-300 sm:text-4xl sm:leading-tight ${index === activeIndex ? 'translate-x-1 text-white drop-shadow-lg' : 'text-white/25 hover:text-white/55'}`}
                >
                  <KaraokeText line={line} nextTimeMs={lines[index + 1]?.timeMs} positionMs={position * 1000} />
                </button>
              ) : (
                <p
                  key={index}
                  className="font-display text-xl font-medium leading-9 text-white/75 sm:text-3xl sm:leading-[1.45]"
                >
                  {line.text}
                </p>
              ),
            )}
          </div>
        )}
      </div>
      {query.data && (
        <div className="border-t border-white/10 px-5 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35 backdrop-blur-xl">
          {query.data.isSynced ? t.music.syncedLyrics : t.music.plainLyrics} ·{' '}
          {query.data.sourceName}
        </div>
      )}

      {editing && (
        <div className="absolute inset-0 z-20 overflow-y-auto bg-black/90 p-4 backdrop-blur-xl sm:p-8">
          <div
            role="dialog"
            aria-label={t.music.lyricsEditor}
            className="mx-auto max-w-5xl rounded-[28px] border border-white/10 bg-[#111214] p-5 shadow-2xl sm:p-8"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-2xl font-bold">{t.music.lyricsEditor}</h3>
                <p className="mt-1 text-sm text-white/40">{t.music.lyricsEditorHint}</p>
              </div>
              <button
                onClick={() => setEditing(false)}
                aria-label={t.common.close}
                className="rounded-full p-3 hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {[
                { label: t.music.lyricsModes.original, value: content, set: setContent },
                {
                  label: t.music.lyricsModes.translation,
                  value: translatedContent,
                  set: setTranslatedContent,
                },
                {
                  label: t.music.lyricsModes.romanization,
                  value: romanizedContent,
                  set: setRomanizedContent,
                },
              ].map((field) => (
                <label key={field.label} className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-white/50">
                    {field.label}
                  </span>
                  <textarea
                    value={field.value}
                    onChange={(event) => field.set(event.target.value)}
                    rows={16}
                    className="music-field resize-y font-mono text-xs leading-5"
                    placeholder="[00:12.50] ..."
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="space-y-2 text-xs font-bold text-white/50">
                {t.music.timingOffset}
                <input
                  type="number"
                  value={offsetMs}
                  onChange={(event) => setOffsetMs(Number(event.target.value) || 0)}
                  className="music-field"
                />
              </label>
              <label className="space-y-2 text-xs font-bold text-white/50">
                {t.music.originalLanguage}
                <input
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  className="music-field"
                  placeholder="tr"
                />
              </label>
              <label className="space-y-2 text-xs font-bold text-white/50">
                {t.music.translationLanguage}
                <input
                  value={translationLanguage}
                  onChange={(event) => setTranslationLanguage(event.target.value)}
                  className="music-field"
                  placeholder="en"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-white/[.07] bg-white/[.025] p-3">
              <label className="min-w-28 flex-1 space-y-1 text-xs font-bold text-white/50">{t.music.translationLanguage}<input value={translationLanguage} onChange={(event) => setTranslationLanguage(event.target.value)} className="music-field" placeholder="en" /></label>
              <button onClick={() => translationLanguage.trim() && autoTranslate.mutate({ trackId, language: translationLanguage.trim() }, { onSuccess: (lyrics) => { const result = lyrics.translations?.find((item) => item.language === translationLanguage.trim()); if (result) { setSelectedTranslation(result.language); setMode('translation'); setTranslatedContent(result.content); } } })} disabled={!translationLanguage.trim() || autoTranslate.isPending || !query.data} className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2.5 text-sm font-bold text-cyan-200 disabled:opacity-40"><Languages className="h-4 w-4" /> {t.music.autoTranslate}</button>
              <button onClick={() => alignLyrics.mutate({ trackId, content }, { onSuccess: setContent })} disabled={!content.trim() || alignLyrics.isPending} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold disabled:opacity-40"><TimerReset className="h-4 w-4" /> {t.music.autoAlign}</button>
              <button onClick={stampNextUntimedLine} disabled={!content.trim()} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold disabled:opacity-40"><TimerReset className="h-4 w-4" /> {t.music.tapTiming}</button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".lrc,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void file.text().then(setContent);
              }}
            />
            <input ref={communityFileRef} type="file" accept=".lrc,text/plain" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((revisionContent) => importRevision.mutate({ trackId, sourceName: file.name, content: revisionContent })); }} />
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/10"
              >
                <Upload className="h-4 w-4" /> {t.music.importLrc}
              </button>
              <button onClick={() => communityFileRef.current?.click()} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/10"><Wand2 className="h-4 w-4" /> {t.music.communityCorrection}</button>
              {query.data && (
                <button
                  onClick={() => writeSidecar.mutate(trackId)}
                  disabled={writeSidecar.isPending}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/10 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" /> {t.music.writeSidecar}
                </button>
              )}
              <button
                onClick={save}
                disabled={!content.trim() || updateLyrics.isPending}
                className="ml-auto inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> {t.common.save}
              </button>
            </div>
            {!!query.data?.translations?.length && <div className="mt-5 rounded-2xl border border-white/[.07] p-4"><p className="text-xs font-black uppercase tracking-wider text-white/35">{t.music.lyricsModes.translation}</p><div className="mt-3 flex flex-wrap gap-2">{query.data.translations.map((translation) => <button key={translation.id} onClick={() => { setSelectedTranslation(translation.language); setMode('translation'); }} className="rounded-full bg-white/[.06] px-3 py-2 text-xs font-bold">{translation.language.toUpperCase()} {translation.isMachine ? `· ${t.music.machineTranslation}` : ''}</button>)}</div></div>}
            {!!query.data?.revisions?.filter((item) => item.status === 'pending').length && <div className="mt-5 rounded-2xl border border-white/[.07] p-4"><p className="text-xs font-black uppercase tracking-wider text-white/35">{t.music.communityCorrection}</p><div className="mt-3 space-y-2">{query.data.revisions.filter((item) => item.status === 'pending').map((revision) => <div key={revision.id} className="flex items-center gap-3 rounded-xl bg-white/[.035] p-3"><span className="min-w-0 flex-1 truncate text-sm">{revision.sourceName}</span><button onClick={() => applyRevision.mutate({ trackId, revisionId: revision.id }, { onSuccess: (lyrics) => setContent(lyrics.content || '') })} className="rounded-full bg-white px-3 py-2 text-xs font-black text-black">{t.music.applyCorrection}</button></div>)}</div></div>}
            {(writeSidecar.data || writeSidecar.error) && (
              <p className="mt-3 text-xs text-white/45">
                {writeSidecar.data
                  ? `${t.music.sidecarWritten}: ${writeSidecar.data.path}`
                  : String(writeSidecar.error)}
              </p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
