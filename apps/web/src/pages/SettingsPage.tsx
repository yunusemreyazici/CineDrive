import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Trash2,
  Database,
  User,
  Lock,
  KeyRound,
  HardDrive,
  FolderPlus,
  Folder,
  EyeOff,
  Activity,
} from 'lucide-react';
import {
  useSessionQuery,
  useUpdateProfileMutation,
  useChangePasswordMutation,
  useGoogleStatusQuery,
  useGoogleConnectionsQuery,
  useUnlinkGoogleMutation,
  useUnlinkGoogleConnectionMutation,
  useLibrariesQuery,
  useCreateLibraryMutation,
  useScanLibraryMutation,
  useLibraryScansQuery,
  useClearLibraryMutation,
  useOpenSubtitlesSettingsQuery,
  useUpdateOpenSubtitlesSettingsMutation,
} from '../hooks/useApi';
import { useUiStore, type ThemeType } from '../stores/useUiStore';
import { MediaManagerPage } from './MediaManagerPage';
import { InsightsPage } from './InsightsPage';
import { MediaHealthPage } from './MediaHealthPage';

type SettingsTab = 'general' | 'manage' | 'storage' | 'health';

const settingsTabs: Array<{
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'general', label: 'Genel', icon: Settings },
  { id: 'manage', label: 'Veri Yönetimi', icon: Database },
  { id: 'storage', label: 'Depolama Analizi', icon: HardDrive },
  { id: 'health', label: 'Medya Sağlığı', icon: Activity },
];

const isSettingsTab = (value: string | null): value is SettingsTab =>
  settingsTabs.some((tab) => tab.id === value);

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab: SettingsTab = isSettingsTab(requestedTab) ? requestedTab : 'general';

  const selectTab = (tab: SettingsTab) => {
    setSearchParams(tab === 'general' ? {} : { tab });
  };

  return (
    <div className="space-y-7">
      <div className="flex items-center gap-3 pb-6 border-b border-zinc-800/60">
        <div className="p-3 bg-brand-600/20 border border-brand-500/30 text-brand-400 rounded-2xl">
          <Settings className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-3xl font-extrabold font-display text-white tracking-tight">Ayarlar</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            Sistem, kütüphane ve medya araçlarını tek yerden yönetin
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Ayar bölümleri"
        className="flex gap-2 overflow-x-auto rounded-2xl border border-zinc-800/70 bg-zinc-950/50 p-2 scrollbar-none"
      >
        {settingsTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.id)}
              className={`flex min-w-max items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                isActive
                  ? 'border-brand-500/40 bg-brand-600/20 text-brand-300 shadow-lg shadow-brand-500/10'
                  : 'border-transparent text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-100'
              }`}
            >
              <Icon className="h-5 w-5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {activeTab === 'general' && <GeneralSettingsContent />}
        {activeTab === 'manage' && <MediaManagerPage />}
        {activeTab === 'storage' && <InsightsPage />}
        {activeTab === 'health' && <MediaHealthPage />}
      </div>
    </div>
  );
};

const GeneralSettingsContent: React.FC = () => {
  const { data: googleStatus, isLoading: isGoogleLoading } = useGoogleStatusQuery();
  const { data: connections = [] } = useGoogleConnectionsQuery();
  const unlinkGoogle = useUnlinkGoogleMutation();
  const unlinkConnection = useUnlinkGoogleConnectionMutation();
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

  const allConnections = connections.length > 0
    ? connections
    : (googleStatus?.connections || (googleStatus?.connection ? [googleStatus.connection as { id?: string; email?: string; googleEmail?: string }] : []));

  return (
    <div className="space-y-8 max-w-4xl">
      {/* User Profile Card */}
      <UserProfileCard />

      {/* Password Change Security Card */}
      <UserPasswordChangeCard />

      {/* Theme Selector Section */}
      <ThemeSettingsCard />

      {/* Library Visibility Section */}
      <LibraryVisibilitySettingsCard />

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

          {allConnections.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              {allConnections.length} Hesap Bağlı
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
        ) : allConnections.length > 0 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Bağlı Google Hesapları:</p>
              <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-2xl bg-zinc-950/60 overflow-hidden">
                {allConnections.map((conn: { id?: string; email?: string; googleEmail?: string }, idx: number) => {
                  const connEmail = (conn as { email?: string; googleEmail?: string }).email || (conn as { googleEmail?: string }).googleEmail || 'Google Hesabı';
                  const connId = (conn as { id?: string }).id;
                  return (
                    <div key={connId || idx} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="font-semibold text-zinc-200 font-mono">{connEmail}</span>
                      </div>
                      {connId ? (
                        <button
                          onClick={() => unlinkConnection.mutate(connId)}
                          disabled={unlinkConnection.isPending}
                          className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-[11px] font-semibold rounded-lg transition-colors"
                        >
                          Kaldır
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={handleConnectGoogle}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all"
              >
                <ExternalLink className="w-4 h-4" />
                + Başka Google Hesabı Bağla
              </button>

              <button
                onClick={() => unlinkGoogle.mutate()}
                disabled={unlinkGoogle.isPending}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold rounded-xl transition-colors"
              >
                <Unlink className="w-4 h-4" />
                Tüm Hesap Bağlantılarını Temizle
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
            disabled={scanLibrary.isPending || lastScan?.status === 'running' || allConnections.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all disabled:opacity-40"
          >
            {scanLibrary.isPending || lastScan?.status === 'running' ? (
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

      {/* Local Disk Library Section */}
      <LocalLibrarySettingsCard />

      {/* OpenSubtitles Integration Section */}
      <OpenSubtitlesSettingsCard />

      {/* Database Management Section */}
      <DatabaseManagementCard />
    </div>
  );
};

const LibraryVisibilitySettingsCard: React.FC = () => {
  const hideMoviesWithoutMetadata = useUiStore(
    (state) => state.hideMoviesWithoutMetadata,
  );
  const setHideMoviesWithoutMetadata = useUiStore(
    (state) => state.setHideMoviesWithoutMetadata,
  );

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-5">
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
        <div className="p-2.5 bg-violet-500/10 text-violet-400 rounded-xl">
          <EyeOff className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold font-display text-white">Kütüphane Görünürlüğü</h3>
          <p className="text-xs text-zinc-400">Film listelerinde gösterilecek içerikleri seçin</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-5 p-4 bg-zinc-950/60 border border-zinc-800 rounded-2xl">
        <div>
          <p className="text-sm font-semibold text-zinc-100">Metadata’sı olmayan filmleri gizle</p>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            TMDB eşleşmesi bulunmayan filmler ana sayfa ve film listelerinde gösterilmez.
            Medya Yönetimi ekranında erişilebilir kalırlar.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={hideMoviesWithoutMetadata}
          aria-label="Metadata’sı olmayan filmleri gizle"
          onClick={() => setHideMoviesWithoutMetadata(!hideMoviesWithoutMetadata)}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
            hideMoviesWithoutMetadata
              ? 'bg-brand-600 border-brand-500'
              : 'bg-zinc-800 border-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              hideMoviesWithoutMetadata ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
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

const LocalLibrarySettingsCard: React.FC = () => {
  const { data: libraries } = useLibrariesQuery();
  const createLibrary = useCreateLibraryMutation();
  const scanLibrary = useScanLibraryMutation();

  const [name, setName] = useState('');
  const [localFolderPath, setLocalFolderPath] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const localLibraries = libraries?.filter((l) => (l as unknown as { storageType?: string }).storageType === 'local') || [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!name.trim()) {
      setErrorMsg('Lütfen kütüphane adı giriniz.');
      return;
    }
    if (!localFolderPath.trim()) {
      setErrorMsg('Lütfen yerel klasör yolu giriniz.');
      return;
    }

    try {
      const newLib = await createLibrary.mutateAsync({
        name: name.trim(),
        storageType: 'local',
        rootFolderId: '',
        localFolderPath: localFolderPath.trim(),
      });

      setSuccessMsg(`"${name}" kütüphanesi oluşturuldu. Tarama başlatılıyor...`);
      setName('');
      setLocalFolderPath('');

      // Auto trigger scan
      scanLibrary.mutate(newLib.id);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Kütüphane oluşturulurken hata oluştu.');
    }
  };

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-display text-white">Yerel Disk / Klasör Kütüphanesi</h3>
            <p className="text-xs text-zinc-400">Sunucunuzdaki veya bilgisayarınızdaki film/dizi klasörlerini tarayın</p>
          </div>
        </div>
      </div>

      {/* Existing Local Libraries List */}
      {localLibraries.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-zinc-300">Kayıtlı Yerel Kütüphaneler</h4>
          <div className="grid grid-cols-1 gap-3">
            {localLibraries.map((lib) => {
              const localPath = (lib as unknown as { localFolderPath?: string }).localFolderPath;
              return (
                <div key={lib.id} className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Folder className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">{lib.name}</p>
                      <p className="text-[11px] font-mono text-zinc-400 truncate">{localPath}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => scanLibrary.mutate(lib.id)}
                    disabled={scanLibrary.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white text-xs font-semibold rounded-xl transition-all"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${scanLibrary.isPending ? 'animate-spin' : ''}`} />
                    <span>Klasörü Tara</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* New Local Library Form */}
      <form onSubmit={handleCreate} className="space-y-4 text-xs">
        <h4 className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
          <FolderPlus className="w-4 h-4 text-brand-400" />
          Yeni Yerel Kütüphane Ekle
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-200">Kütüphane İsmi</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn: Yerel Filmlerim"
              className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-200">Klasör Yolu (Absolute Path)</label>
            <input
              type="text"
              value={localFolderPath}
              onChange={(e) => setLocalFolderPath(e.target.value)}
              placeholder="Örn: /Users/username/Movies veya D:\Filmler"
              className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors font-mono"
            />
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{successMsg}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={createLibrary.isPending || !name.trim() || !localFolderPath.trim()}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-40 flex items-center gap-2"
        >
          {createLibrary.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Oluşturuluyor...</span>
            </>
          ) : (
            <>
              <FolderPlus className="w-4 h-4" />
              <span>Yerel Kütüphaneyi Oluştur ve Tara</span>
            </>
          )}
        </button>
      </form>
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
        ...(password ? { password } : {}),
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
                  <span>Kaydediliyor...</span>
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

const DatabaseManagementCard: React.FC = () => {
  const { data: libraries } = useLibrariesQuery();
  const activeLibrary = libraries?.[0];
  const clearLibrary = useClearLibraryMutation();
  const [showClearDbConfirmModal, setShowClearDbConfirmModal] = useState<boolean>(false);

  return (
    <>
      <div className="bg-rose-500/5 border border-rose-500/20 rounded-3xl p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-rose-500/20 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-xl">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display text-white">Veritabanı Yönetimi</h3>
              <p className="text-xs text-zinc-400">Kütüphane veritabanı sıfırlama ve temizlik işlemleri</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-zinc-200">Kütüphane Veritabanını Temizle</h4>
            <p className="text-xs text-zinc-400 leading-relaxed max-w-xl">
              Taranan tüm film, dizi, bölüm, altyazı ve izleme geçmişi verilerini CineDrive veritabanından siler. Google Drive hesaplarınızdaki orijinal dosyalarınıza dokunulmaz.
            </p>
          </div>

          <button
            onClick={() => setShowClearDbConfirmModal(true)}
            disabled={!activeLibrary || clearLibrary.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-rose-500/20 transition-all disabled:opacity-40 flex-shrink-0"
          >
            <Trash2 className="w-4 h-4" />
            Veritabanını Temizle
          </button>
        </div>
      </div>

      {showClearDbConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-500/20 text-rose-400 rounded-2xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white font-display">Veritabanı Sıfırlama</h3>
                <p className="text-xs text-zinc-400">Bu işlem geri alınamaz!</p>
              </div>
            </div>

            <p className="text-sm text-zinc-300 leading-relaxed">
              CineDrive kütüphanesine ait tüm taranmış medya kayıtları, bölümler, altyazılar ve izleme geçmişi veritabanından silinecektir. Google Drive dosyalarınız silinmez. Devam etmek istiyor musunuz?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setShowClearDbConfirmModal(false)}
                className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition-all"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!activeLibrary) return;
                  try {
                    await clearLibrary.mutateAsync(activeLibrary.id);
                    setShowClearDbConfirmModal(false);
                  } catch {
                    // Error handled in react-query
                  }
                }}
                disabled={clearLibrary.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50"
              >
                {clearLibrary.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Temizleniyor...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Evet, Tümünü Temizle
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const UserProfileCard: React.FC = () => {
  const { data: session } = useSessionQuery();
  const updateProfile = useUpdateProfileMutation();

  const [name, setName] = useState('');
  const [successMessage, setSuccessMessage] = useState(false);

  useEffect(() => {
    if (session?.user?.name) {
      setName(session.user.name);
    }
  }, [session]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(false);
    if (!name.trim() || name.trim().length < 2) return;

    updateProfile.mutate(
      { name: name.trim() },
      {
        onSuccess: () => {
          setSuccessMessage(true);
          setTimeout(() => setSuccessMessage(false), 4000);
        },
      },
    );
  };

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-brand-600/20 text-brand-400 rounded-xl">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-display text-white">Profil Bilgileri</h3>
            <p className="text-xs text-zinc-400">Görüntülenen isim ve hesap detayları</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-200">Görüntülenen İsim</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Adınız Soyadınız"
              className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-200">E-posta Adresi (Salt Okunur)</label>
            <input
              type="email"
              value={session?.user?.email || ''}
              disabled
              className="w-full px-4 py-2.5 bg-zinc-950/40 border border-zinc-800/60 rounded-xl text-zinc-500 font-mono cursor-not-allowed"
            />
          </div>
        </div>

        {updateProfile.error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            {updateProfile.error.message || 'Profil güncellenirken bir hata oluştu.'}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={updateProfile.isPending || !name.trim() || name === session?.user?.name}
            className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all disabled:opacity-40 flex items-center gap-2"
          >
            {updateProfile.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Güncelleniyor...</span>
              </>
            ) : (
              <span>Profili Güncelle</span>
            )}
          </button>

          {successMessage && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold animate-in fade-in">
              <CheckCircle2 className="w-4 h-4" />
              Profil bilgileriniz kaydedildi!
            </span>
          )}
        </div>
      </form>
    </div>
  );
};

const UserPasswordChangeCard: React.FC = () => {
  const changePassword = useChangePasswordMutation();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(false);

    if (!currentPassword) {
      setErrorMsg('Lütfen mevcut şifrenizi giriniz.');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMsg('Yeni şifre en az 6 karakter olmalıdır.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Yeni şifre ile şifre tekrarı uyuşmuyor.');
      return;
    }

    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setSuccessMsg(true);
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setTimeout(() => setSuccessMsg(false), 5000);
        },
        onError: (err: unknown) => {
          const apiErr =
            err && typeof err === 'object' && 'response' in err
              ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
              : err instanceof Error
                ? err.message
                : null;
          setErrorMsg(apiErr || 'Şifre değiştirilirken bir hata oluştu.');
        },
      },
    );
  };

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-display text-white">Güvenlik & Şifre Değiştirme</h3>
            <p className="text-xs text-zinc-400">Argon2id şifreleme ile hesabınızın güvenliğini sağlayın</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="space-y-1.5 max-w-md">
          <label className="block font-semibold text-zinc-200">Mevcut Şifreniz</label>
          <div className="relative">
            <KeyRound className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full pl-10 pr-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-200">Yeni Şifre (En az 6 Karakter)</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block font-semibold text-zinc-200">Yeni Şifre Tekrarı</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 max-w-xl">
            {errorMsg}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={changePassword.isPending || !currentPassword || !newPassword || !confirmPassword}
            className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl shadow-lg shadow-rose-500/20 transition-all disabled:opacity-40 flex items-center gap-2"
          >
            {changePassword.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Değiştiriliyor...</span>
              </>
            ) : (
              <span>Şifreyi Değiştir</span>
            )}
          </button>

          {successMsg && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold animate-in fade-in">
              <CheckCircle2 className="w-4 h-4" />
              Şifreniz başarıyla güncellendi!
            </span>
          )}
        </div>
      </form>
    </div>
  );
};
