import React, { useId, useState } from 'react';
import { Check, Plus, Search, Loader2, Clock, Download } from 'lucide-react';
import type { SubtitleTrackType } from '../types/player';
import { usePlayerStore } from '../stores/usePlayerStore';

interface OpenSubResult {
  id: string;
  fileId: number;
  filename: string;
  languageName: string;
  languageCode: string;
}

interface SubtitleMenuProps {
  mediaId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  subtitles: SubtitleTrackType[];
  activeSubtitleId: string | null;
  onSelectSubtitle: (id: string | null) => void;
  onUploadCustomSubtitle?: (file: File) => void;
  onSelectOpenSubtitle?: (fileId: number, label: string, languageCode: string) => Promise<void>;
  onClose: () => void;
}

export const SubtitleMenu: React.FC<SubtitleMenuProps> = ({
  mediaId,
  seasonNumber,
  episodeNumber,
  subtitles,
  activeSubtitleId,
  onSelectSubtitle,
  onUploadCustomSubtitle,
  onSelectOpenSubtitle,
  onClose,
}) => {
  const fieldId = useId();
  const [activeTab, setActiveTab] = useState<'tracks' | 'search' | 'sync' | 'style'>('tracks');
  const [searchResults, setSearchResults] = useState<OpenSubResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingFileId, setDownloadingFileId] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const uniqueSubtitles = Array.from(
    new Map(subtitles.map((subtitle) => [subtitle.id, subtitle])).values(),
  );

  const {
    subtitleDelay,
    setSubtitleDelay,
    subtitleFontSize,
    setSubtitleFontSize,
    subtitleBgColor,
    setSubtitleBgColor,
  } = usePlayerStore();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadCustomSubtitle) {
      onUploadCustomSubtitle(file);
      onClose();
    }
  };

  const handleSearchOpenSubtitles = async () => {
    if (!mediaId) return;
    setIsSearching(true);
    setSearchError(null);

    try {
      let url = `/api/media/subtitles/opensubtitles/search?mediaId=${encodeURIComponent(mediaId)}`;
      if (seasonNumber !== undefined) url += `&seasonNumber=${seasonNumber}`;
      if (episodeNumber !== undefined) url += `&episodeNumber=${episodeNumber}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Arama başarısız');
      const data = (await res.json()) as {
        results: OpenSubResult[];
        message?: string;
      };
      setSearchResults(data.results || []);
      if ((data.results || []).length === 0) {
        const errorMessages: Record<string, string> = {
          NO_API_KEY: 'OpenSubtitles API anahtarı ayarlanmamış.',
          INVALID_API_KEY: 'OpenSubtitles API anahtarı geçersiz.',
          INVALID_SEARCH: 'OpenSubtitles bu başlıkla arama yapamadı.',
          RATE_LIMITED: 'OpenSubtitles arama kotası doldu. Biraz sonra tekrar deneyin.',
          SERVICE_UNAVAILABLE: 'OpenSubtitles servisine şu anda ulaşılamıyor.',
          API_ERROR: 'OpenSubtitles servisi geçici olarak yanıt vermiyor.',
          SEARCH_FAILED: 'OpenSubtitles araması zaman aşımına uğradı.',
        };
        setSearchError(
          (data.message && errorMessages[data.message]) || 'Uygun altyazı bulunamadı.',
        );
      }
    } catch {
      setSearchError('OpenSubtitles altyazı araması gerçekleştirilemedi.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownloadSubtitle = async (item: OpenSubResult) => {
    if (!onSelectOpenSubtitle) return;
    setDownloadingFileId(item.fileId);
    try {
      await onSelectOpenSubtitle(
        item.fileId,
        `${item.languageName} (OpenSubtitles)`,
        item.languageCode,
      );
      onClose();
    } catch {
      setSearchError('Altyazı indirilemedi.');
    } finally {
      setDownloadingFileId(null);
    }
  };

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+8.5rem)] z-50 w-auto rounded-2xl border border-zinc-800 bg-zinc-900/95 p-3 text-zinc-100 shadow-2xl backdrop-blur-xl animate-in fade-in duration-150 sm:absolute sm:inset-x-auto sm:bottom-16 sm:right-16 sm:w-80">
      {/* Header & Tabs */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 w-full justify-between">
          <button
            onClick={() => setActiveTab('tracks')}
            className={`flex-1 py-1 text-[11px] font-bold rounded-lg transition-colors text-center ${
              activeTab === 'tracks' ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Altyazılar
          </button>
          <button
            onClick={() => {
              setActiveTab('search');
              if (searchResults.length === 0 && !isSearching) {
                handleSearchOpenSubtitles();
              }
            }}
            className={`flex-1 py-1 text-[11px] font-bold rounded-lg transition-colors text-center ${
              activeTab === 'search' ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Ara
          </button>
          <button
            onClick={() => setActiveTab('sync')}
            className={`flex-1 py-1 text-[11px] font-bold rounded-lg transition-colors text-center ${
              activeTab === 'sync' ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Senkron
          </button>
          <button
            onClick={() => setActiveTab('style')}
            className={`flex-1 py-1 text-[11px] font-bold rounded-lg transition-colors text-center ${
              activeTab === 'style' ? 'bg-brand-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Stil
          </button>
        </div>
      </div>

      {/* Tab 1: Tracks List */}
      {activeTab === 'tracks' && (
        <div className="space-y-1 max-h-60 overflow-y-auto">
          <button
            onClick={() => {
              onSelectSubtitle(null);
              onClose();
            }}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl font-medium transition-colors ${
              activeSubtitleId === null
                ? 'bg-brand-600/20 text-brand-400'
                : 'text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <span>Altyazı Kapalı</span>
            {activeSubtitleId === null && <Check className="w-3.5 h-3.5" />}
          </button>

          {uniqueSubtitles.map((sub) => (
            <button
              key={sub.id}
              onClick={() => {
                onSelectSubtitle(sub.id);
                onClose();
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl font-medium transition-colors ${
                activeSubtitleId === sub.id
                  ? 'bg-brand-600/20 text-brand-400'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <span className="truncate">{sub.label}</span>
              {activeSubtitleId === sub.id && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}

          <div className="mt-2 pt-2 border-t border-zinc-800/80">
            <label className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 font-medium cursor-pointer transition-colors">
              <Plus className="w-3.5 h-3.5 text-brand-400" />
              <span>Altyazı Dosyası Yükle (.srt/.vtt)</span>
              <input
                type="file"
                accept=".srt,.vtt"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}

      {/* Tab 2: OpenSubtitles Search */}
      {activeTab === 'search' && (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold text-zinc-400">OpenSubtitles Sonuçları</span>
            <button
              onClick={handleSearchOpenSubtitles}
              disabled={isSearching}
              className="text-[11px] text-brand-400 hover:underline flex items-center gap-1"
            >
              {isSearching ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Search className="w-3 h-3" />
              )}
              <span>Yenile</span>
            </button>
          </div>

          {isSearching && (
            <div className="flex items-center justify-center py-6 text-zinc-500 text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
              <span>Altyazılar aranıyor...</span>
            </div>
          )}

          {!isSearching && searchError && (
            <p className="text-xs text-zinc-400 text-center py-4">{searchError}</p>
          )}

          {!isSearching &&
            searchResults.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleDownloadSubtitle(item)}
                aria-label={`${item.filename} altyazısını indir`}
                className="group flex w-full items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-800/50 p-2 text-left transition-colors hover:bg-zinc-800"
              >
                <span className="min-w-0 flex-1 pr-2">
                  <span className="block truncate text-xs font-semibold text-zinc-200 group-hover:text-brand-300">
                    {item.filename}
                  </span>
                  <span className="block text-[10px] text-zinc-400">{item.languageName}</span>
                </span>
                <span className="rounded-lg bg-brand-600/20 p-1.5 text-brand-400 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                  {downloadingFileId === item.fileId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                </span>
              </button>
            ))}
        </div>
      )}

      {/* Tab 3: Synchronization (Delay Adjust) */}
      {activeTab === 'sync' && (
        <div className="space-y-3 p-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-medium">
              <Clock className="w-3.5 h-3.5 text-brand-400" />
              <span>Gecikme (Zamanlama):</span>
            </div>
            <span className="text-xs font-mono font-bold text-brand-400">
              {subtitleDelay > 0 ? `+${subtitleDelay.toFixed(1)}s` : `${subtitleDelay.toFixed(1)}s`}
            </span>
          </div>

          <div className="grid grid-cols-6 gap-1">
            {[-1.0, -0.5, -0.1, 0.1, 0.5, 1.0].map((step) => (
              <button
                key={step}
                onClick={() => setSubtitleDelay(parseFloat((subtitleDelay + step).toFixed(1)))}
                className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-semibold rounded-lg transition-colors"
              >
                {step > 0 ? `+${step}s` : `${step}s`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <label htmlFor={`${fieldId}-delay`} className="text-[11px] text-zinc-400 font-medium">
              Özel Değer (sn):
            </label>
            <input
              id={`${fieldId}-delay`}
              type="number"
              step="0.1"
              value={subtitleDelay}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) setSubtitleDelay(val);
              }}
              className="w-20 px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-center text-zinc-100 focus:outline-none focus:border-brand-500"
            />
            <button
              onClick={() => setSubtitleDelay(0)}
              className="flex-1 py-1.5 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs rounded-lg transition-colors font-medium"
            >
              Sıfırla (0.0s)
            </button>
          </div>

          <div className="p-2 bg-zinc-900/60 border border-zinc-800/60 rounded-xl text-[10px] text-zinc-400 flex items-center justify-between">
            <span>Klavye Kısayolları:</span>
            <div className="flex items-center gap-1 font-mono text-zinc-300">
              <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[10px]">
                Z
              </kbd>
              <span>(-0.1s)</span>
              <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[10px] ml-1">
                X
              </kbd>
              <span>(+0.1s)</span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Styling Options */}
      {activeTab === 'style' && (
        <div className="space-y-3 p-1">
          <div>
            <span className="text-[11px] font-bold text-zinc-400 block mb-1">Font Boyutu</span>
            <div className="grid grid-cols-4 gap-1.5">
              {[75, 100, 125, 150].map((size) => (
                <button
                  key={size}
                  onClick={() => setSubtitleFontSize(size)}
                  className={`py-1.5 text-xs font-bold rounded-xl transition-colors ${
                    subtitleFontSize === size
                      ? 'bg-brand-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  %{size}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[11px] font-bold text-zinc-400 block mb-1">Arka Plan Stili</span>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { key: 'black', label: 'Siyah Kutu' },
                { key: 'shadow', label: 'Gölge' },
                { key: 'transparent', label: 'Saydam' },
              ].map((style) => (
                <button
                  key={style.key}
                  onClick={() =>
                    setSubtitleBgColor(style.key as 'black' | 'shadow' | 'transparent')
                  }
                  className={`py-1.5 text-[11px] font-semibold rounded-xl transition-colors ${
                    subtitleBgColor === style.key
                      ? 'bg-brand-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
