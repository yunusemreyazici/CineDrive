import React from 'react';
import {
  Settings,
  ShieldCheck,
  RefreshCw,
  Unlink,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Palette,
  Check,
} from 'lucide-react';
import {
  useGoogleStatusQuery,
  useUnlinkGoogleMutation,
  useLibrariesQuery,
  useScanLibraryMutation,
  useLibraryScansQuery,
  useOpenSubtitlesSettingsQuery,
  useUpdateOpenSubtitlesSettingsMutation,
} from '../hooks/useApi';
import { useUiStore, type ThemeType } from '../stores/useUiStore';

export const SettingsPage: React.FC = () => {
  const { data: googleStatus, isLoading: isGoogleLoading } = useGoogleStatusQuery();
  const unlinkGoogle = useUnlinkGoogleMutation();
  const { data: libraries } = useLibrariesQuery();
  const scanLibrary = useScanLibraryMutation();

  const activeLibrary = libraries?.[0];
  const { data: scanHistory } = useLibraryScansQuery(activeLibrary?.id);
  const lastScan = scanHistory?.[0];

  const handleConnectGoogle = () => {
    window.location.href = '/api/auth/google';
  };

  const handleScanTrigger = () => {
    if (activeLibrary) {
      scanLibrary.mutate(activeLibrary.id);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center gap-3 pb-6 border-b border-zinc-800/60">
        <div className="p-3 bg-brand-600/20 border border-brand-500/30 text-brand-400 rounded-2xl">
          <Settings className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold font-display text-white tracking-tight">Sistem Ayarları</h2>
          <p className="text-sm text-zinc-400 mt-0.5">Google Drive entegrasyonu, tema ve kütüphane tarama yönetimi</p>
        </div>
      </div>

      {/* Theme Selector Section */}
      <ThemeSettingsCard />

      {/* Google Drive OAuth Section */}
      <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display text-white">Google Drive Bağlantısı & Ortak Sürücüler</h3>
              <p className="text-xs text-zinc-400">OAuth 2.0 Salt Okunur Medya & Shared Drive Erişimi</p>
            </div>
          </div>

          {googleStatus?.connected ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              Bağlandı
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4" />
              Bağlı Değil
            </span>
          )}
        </div>

        {isGoogleLoading ? (
          <div className="h-12 bg-zinc-800/50 rounded-xl animate-pulse" />
        ) : googleStatus?.connected ? (
          <div className="space-y-4">
            <div className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-2xl space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 font-medium">Bağlı Hesap:</span>
                <span className="text-zinc-200 font-semibold font-mono">
                  {(googleStatus.connection as { email?: string })?.email || 'Bilinmiyor'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={handleConnectGoogle}
                className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-xl border border-zinc-700 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Başka Google Hesabı Bağla
              </button>

              <button
                onClick={() => unlinkGoogle.mutate()}
                disabled={unlinkGoogle.isPending}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold rounded-xl transition-colors"
              >
                <Unlink className="w-4 h-4" />
                Hesap Bağlantısını Kaldır
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-zinc-400 leading-relaxed">
              Google Drive hesabınızdaki veya Ortak Sürücülerinizdeki (Shared Drives) medya klasörlerini taramak ve izlemek için Google yetkilendirmesini tamamlamalısınız.
            </p>
            <button
              onClick={handleConnectGoogle}
              className="flex items-center gap-2 px-5 py-3 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              Google Drive’ı Bağla
            </button>
          </div>
        )}
      </div>

      {/* Library Scanning Section */}
      <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand-600/20 text-brand-400 rounded-xl">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display text-white">Kütüphane Taraması</h3>
              <p className="text-xs text-zinc-400">Google Drive Medya Klasörü Senkronizasyonu</p>
            </div>
          </div>

          <button
            onClick={handleScanTrigger}
            disabled={scanLibrary.isPending || !googleStatus?.connected}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all disabled:opacity-40"
          >
            {scanLibrary.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Taranıyor...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Kütüphaneyi Tara
              </>
            )}
          </button>
        </div>

        {scanLibrary.error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-xs text-red-400">
            <p className="font-semibold">Tarama Başarısız</p>
            <p>{scanLibrary.error.message}</p>
          </div>
        )}

        {lastScan && (
          <div className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-2xl space-y-3 text-xs">
            <h4 className="font-semibold text-zinc-200 font-display">Son Tarama Özeti</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
              <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-800">
                <span className="text-zinc-500 block mb-0.5">Durum</span>
                <span className="text-brand-400 font-bold capitalize">{lastScan.status}</span>
              </div>
              <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-800">
                <span className="text-zinc-500 block mb-0.5">Eklenen</span>
                <span className="text-emerald-400 font-bold">{lastScan.addedCount} Dosya</span>
              </div>
              <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-800">
                <span className="text-zinc-500 block mb-0.5">Güncellenen</span>
                <span className="text-blue-400 font-bold">{lastScan.updatedCount} Dosya</span>
              </div>
              <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-800">
                <span className="text-zinc-500 block mb-0.5">Hata</span>
                <span className="text-red-400 font-bold">{lastScan.errorCount} Hata</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* OpenSubtitles Integration Section */}
      <OpenSubtitlesSettingsCard />
    </div>
  );
};

const ThemeSettingsCard: React.FC = () => {
  const { theme, setTheme } = useUiStore();

  const themes: Array<{ id: ThemeType; name: string; desc: string; bgClass: string; accentClass: string }> = [
    {
      id: 'default',
      name: 'CineDrive Red',
      desc: 'Orijinal Kırmızı Tema',
      bgClass: 'bg-zinc-950',
      accentClass: 'bg-red-600',
    },
    {
      id: 'midnight',
      name: 'OLED Midnight',
      desc: 'Siyah & Cyan',
      bgClass: 'bg-black',
      accentClass: 'bg-cyan-500',
    },
    {
      id: 'neon',
      name: 'Cyberpunk Neon',
      desc: 'Mor & Pembe Accent',
      bgClass: 'bg-slate-950',
      accentClass: 'bg-purple-500',
    },
    {
      id: 'emerald',
      name: 'Emerald Green',
      desc: 'Derin Zümrüt Yeşili',
      bgClass: 'bg-zinc-950',
      accentClass: 'bg-emerald-500',
    },
  ];

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
        <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
          <Palette className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold font-display text-white">Görünüm ve Renk Temaları</h3>
          <p className="text-xs text-zinc-400">Arayüz renk stilini özelleştirin</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {themes.map((t) => {
          const isSelected = theme === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`p-4 rounded-2xl border text-left transition-all relative space-y-3 ${
                isSelected
                  ? 'bg-zinc-900 border-brand-500 shadow-lg ring-1 ring-brand-500'
                  : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded-full ${t.accentClass}`} />
                  <span className="text-xs font-bold text-white">{t.name}</span>
                </div>
                {isSelected && <Check className="w-4 h-4 text-brand-400" />}
              </div>
              <p className="text-[11px] text-zinc-400">{t.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const OpenSubtitlesSettingsCard: React.FC = () => {
  const { data: openSubSettings, isLoading } = useOpenSubtitlesSettingsQuery();
  const updateSettings = useUpdateOpenSubtitlesSettingsMutation();

  const [apiKey, setApiKey] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [preferredLanguages, setPreferredLanguages] = React.useState('tr,en');
  const [savedSuccess, setSavedSuccess] = React.useState(false);

  React.useEffect(() => {
    if (openSubSettings) {
      setApiKey(openSubSettings.apiKey || '');
      setUsername(openSubSettings.username || '');
      setPreferredLanguages(openSubSettings.preferredLanguages || 'tr,en');
    }
  }, [openSubSettings]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(false);
    updateSettings.mutate(
      {
        apiKey,
        username,
        password,
        preferredLanguages,
      },
      {
        onSuccess: () => {
          setSavedSuccess(true);
          setTimeout(() => setSavedSuccess(false), 4000);
        },
      },
    );
  };

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-display text-white">OpenSubtitles v1 Ayarları</h3>
            <p className="text-xs text-zinc-400">Çevrimiçi altyazı arama ve otomatik indirme servisi</p>
          </div>
        </div>

        {openSubSettings?.hasApiKey ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            API Anahtarı Aktif
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4" />
            API Anahtarı Eksik
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="h-24 bg-zinc-800/50 rounded-xl animate-pulse" />
      ) : (
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-200">
              OpenSubtitles API Key (Consumer Key)
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Örn: N1wK2wX9oW2e1tV8X0y5z6a7b8c9d0e1"
              className="w-full px-4 py-3 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="block font-semibold text-zinc-200">Kullanıcı Adı (Opsiyonel)</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="OpenSubtitles Kullanıcı Adı"
                className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-semibold text-zinc-200">Parola (Opsiyonel)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5 pt-2">
            <label className="block font-semibold text-zinc-200">Aranacak Altyazı Dilleri</label>
            <input
              type="text"
              value={preferredLanguages}
              onChange={(e) => setPreferredLanguages(e.target.value)}
              placeholder="tr,en"
              className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={updateSettings.isPending}
              className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all flex items-center gap-2"
            >
              {updateSettings.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Kaydedildiği...</span>
                </>
              ) : (
                <span>Ayarları Kaydet</span>
              )}
            </button>

            {savedSuccess && (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold animate-in fade-in">
                <CheckCircle2 className="w-4 h-4" />
                OpenSubtitles ayarları kaydedildi!
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
};
