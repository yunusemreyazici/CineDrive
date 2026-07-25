import React, { Suspense, useEffect, useMemo, useState } from 'react';
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
  Search,
  ChevronRight,
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
  useUpdateLibraryMutation,
  useScanLibraryMutation,
  useLibraryScansQuery,
  useClearLibraryMutation,
  useOpenSubtitlesSettingsQuery,
  useUpdateOpenSubtitlesSettingsMutation,
} from '../hooks/useApi';
import { useUiStore, type ThemeType } from '../stores/useUiStore';

const MediaManagerPage = React.lazy(() =>
  import('./MediaManagerPage').then((module) => ({ default: module.MediaManagerPage })),
);
const InsightsPage = React.lazy(() =>
  import('./InsightsPage').then((module) => ({ default: module.InsightsPage })),
);
const MediaHealthPage = React.lazy(() =>
  import('./MediaHealthPage').then((module) => ({ default: module.MediaHealthPage })),
);

type SettingsTab = 'general' | 'manage' | 'storage' | 'health';

const settingsTabs: Array<{
  id: SettingsTab;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'general', label: 'Genel', description: 'Hesap, bağlantılar ve tercihler', icon: Settings },
  { id: 'manage', label: 'Veri Yönetimi', description: 'İçerikleri düzenleyin ve temizleyin', icon: Database },
  { id: 'storage', label: 'Depolama Analizi', description: 'Alan kullanımını ve tekrarları görün', icon: HardDrive },
  { id: 'health', label: 'Medya Sağlığı', description: 'Oynatma ve analiz durumunu izleyin', icon: Activity },
];

const settingsSearchItems: Array<{
  label: string;
  description: string;
  tab: SettingsTab;
  targetId?: string;
}> = [
  { label: 'Profil Bilgileri', description: 'Ad ve e-posta', tab: 'general', targetId: 'settings-profile' },
  { label: 'Güvenlik ve Şifre', description: 'Hesap şifresini değiştirin', tab: 'general', targetId: 'settings-security' },
  { label: 'Görünüm ve Temalar', description: 'Arayüz renk temasını seçin', tab: 'general', targetId: 'settings-appearance' },
  { label: 'Kütüphane Görünürlüğü', description: 'Metadata filtresini yönetin', tab: 'general', targetId: 'settings-visibility' },
  { label: 'Google Drive', description: 'Bağlı Google hesapları', tab: 'general', targetId: 'settings-google' },
  { label: 'Kütüphane Taraması', description: 'Medya taramasını başlatın', tab: 'general', targetId: 'settings-scan' },
  { label: 'Yerel Kütüphane', description: 'Yerel klasörleri yönetin', tab: 'general', targetId: 'settings-local-library' },
  { label: 'OpenSubtitles', description: 'Altyazı servisi ayarları', tab: 'general', targetId: 'settings-opensubtitles' },
  { label: 'Veritabanı', description: 'Kütüphane verilerini temizleyin', tab: 'general', targetId: 'settings-database' },
  { label: 'Hakkında', description: 'CineDrive sürüm bilgisi', tab: 'general', targetId: 'settings-about' },
  { label: 'Veri Yönetimi', description: 'Toplu içerik işlemleri', tab: 'manage' },
  { label: 'Depolama Analizi', description: 'Alan ve mükerrer dosyalar', tab: 'storage' },
  { label: 'Medya Sağlığı', description: 'Oynatma uyumluluğu ve HLS işleri', tab: 'health' },
];

const isSettingsTab = (value: string | null): value is SettingsTab =>
  settingsTabs.some((tab) => tab.id === value);

export const SettingsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsSearch, setSettingsSearch] = useState('');
  const requestedTab = searchParams.get('tab');
  const activeTab: SettingsTab = isSettingsTab(requestedTab) ? requestedTab : 'general';
  const normalizedSearch = settingsSearch.trim().toLocaleLowerCase('tr-TR');
  const searchResults = useMemo(
    () => normalizedSearch
      ? settingsSearchItems.filter((item) =>
          `${item.label} ${item.description}`.toLocaleLowerCase('tr-TR').includes(normalizedSearch),
        ).slice(0, 6)
      : [],
    [normalizedSearch],
  );

  const selectTab = (tab: SettingsTab) => {
    setSearchParams(tab === 'general' ? {} : { tab });
  };

  const openSearchResult = (item: (typeof settingsSearchItems)[number]) => {
    selectTab(item.tab);
    setSettingsSearch('');
    const targetId = item.targetId;
    if (targetId) {
      window.setTimeout(() => {
        document.getElementById(targetId)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 80);
    }
  };

  return (
    <div className="settings-compact">
      <header className="mb-5 flex flex-col gap-4 border-b border-zinc-800/70 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-white">Ayarlar</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            CineDrive deneyimini, bağlantıları ve medya araçlarını yönetin
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={settingsSearch}
            onChange={(event) => setSettingsSearch(event.target.value)}
            placeholder="Ayarlarda ara"
            aria-label="Ayarlarda ara"
            className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 pl-9 pr-3 text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-brand-500/70"
          />
          {normalizedSearch ? (
            <div className="absolute right-0 top-12 z-30 w-full min-w-72 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 p-1.5 shadow-2xl shadow-black/60">
              {searchResults.length > 0 ? searchResults.map((item) => (
                <button
                  key={`${item.tab}-${item.label}`}
                  type="button"
                  onClick={() => openSearchResult(item)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-zinc-900"
                >
                  <span>
                    <span className="block text-xs font-semibold text-zinc-100">{item.label}</span>
                    <span className="mt-0.5 block text-[11px] text-zinc-500">{item.description}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
                </button>
              )) : (
                <p className="px-3 py-4 text-center text-xs text-zinc-500">Eşleşen ayar bulunamadı.</p>
              )}
            </div>
          ) : null}
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/25 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-visible">
        <aside
          role="tablist"
          aria-label="Ayar bölümleri"
          className="scrollbar-none flex gap-1 overflow-x-auto border-b border-zinc-800/80 bg-zinc-950/60 p-2 lg:sticky lg:top-24 lg:block lg:min-h-[calc(100vh-10rem)] lg:space-y-1 lg:self-start lg:border-b-0 lg:border-r lg:p-3"
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
              className={`group flex min-w-max items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all lg:w-full ${
                isActive
                  ? 'border-brand-500/30 bg-brand-500/10 text-brand-300'
                  : 'border-transparent text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-100'
              }`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-brand-400' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
              <span>
                <span className="block text-xs font-semibold">{tab.label}</span>
                <span className="mt-0.5 hidden text-[10px] font-normal leading-4 text-zinc-500 lg:block">
                  {tab.description}
                </span>
              </span>
            </button>
            );
          })}
        </aside>

        <div role="tabpanel" className={`min-w-0 p-3 md:p-5 ${activeTab === 'general' ? '' : 'settings-tool'}`}>
          {activeTab === 'general' ? <GeneralSettingsContent /> : null}
          <Suspense fallback={<SettingsToolFallback />}>
            {activeTab === 'manage' ? <MediaManagerPage /> : null}
            {activeTab === 'storage' ? <InsightsPage /> : null}
            {activeTab === 'health' ? <MediaHealthPage /> : null}
          </Suspense>
        </div>
      </div>
    </div>
  );
};

const SettingsToolFallback: React.FC = () => (
  <div className="flex min-h-72 items-center justify-center gap-2 text-xs text-zinc-500">
    <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
    Bölüm yükleniyor…
  </div>
);

const GeneralSettingsContent: React.FC = () => {
  const { data: googleStatus, isLoading: isGoogleLoading } = useGoogleStatusQuery();
  const { data: connections = [] } = useGoogleConnectionsQuery();
  const unlinkGoogle = useUnlinkGoogleMutation();
  const unlinkConnection = useUnlinkGoogleConnectionMutation();
  const { data: libraries } = useLibrariesQuery();
  const updateLibrary = useUpdateLibraryMutation();
  const scanLibrary = useScanLibraryMutation();

  const activeLibrary = libraries?.find((library) => library.storageType === 'gdrive');
  const [driveScanMode, setDriveScanMode] = useState<'all' | 'folder'>('all');
  const [driveFolderId, setDriveFolderId] = useState('');
  const [driveConnectionId, setDriveConnectionId] = useState('');
  const [scanSettingsSaved, setScanSettingsSaved] = useState(false);

  useEffect(() => {
    if (!activeLibrary) return;
    setDriveScanMode(activeLibrary.rootFolderId ? 'folder' : 'all');
    setDriveFolderId(activeLibrary.rootFolderId || '');
    setDriveConnectionId(activeLibrary.googleConnectionId || '');
  }, [
    activeLibrary?.id,
    activeLibrary?.rootFolderId,
    activeLibrary?.googleConnectionId,
  ]);

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

  const handleSaveScanSettings = async () => {
    if (!activeLibrary) return;
    setScanSettingsSaved(false);
    await updateLibrary.mutateAsync({
      id: activeLibrary.id,
      data: {
        rootFolderId: driveScanMode === 'folder' ? driveFolderId.trim() : '',
        googleConnectionId: driveConnectionId || null,
      },
    });
    setScanSettingsSaved(true);
  };

  const allConnections = connections.length > 0
    ? connections
    : (googleStatus?.connections || (googleStatus?.connection ? [googleStatus.connection as { id?: string; email?: string; googleEmail?: string }] : []));

  return (
    <div className="settings-general">
      {/* User Profile Card */}
      <UserProfileCard />

      {/* Password Change Security Card */}
      <UserPasswordChangeCard />

      {/* Theme Selector Section */}
      <ThemeSettingsCard />

      {/* Library Visibility Section */}
      <LibraryVisibilitySettingsCard />

      {/* Google Drive OAuth Section */}
      <div id="settings-google" className="scroll-mt-24 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
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
      <div id="settings-scan" className="scroll-mt-24 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              setDriveScanMode('all');
              setScanSettingsSaved(false);
            }}
            className={`p-4 text-left rounded-2xl border transition-colors ${
              driveScanMode === 'all'
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
            }`}
          >
            <p className="text-sm font-semibold text-white">Tüm Google Drive</p>
            <p className="mt-1 text-xs text-zinc-400">
              Bağlı hesaptaki tüm medya dosyalarını ve erişilebilir Ortak Sürücüleri tarar.
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              setDriveScanMode('folder');
              setScanSettingsSaved(false);
            }}
            className={`p-4 text-left rounded-2xl border transition-colors ${
              driveScanMode === 'folder'
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
            }`}
          >
            <p className="text-sm font-semibold text-white">Belirli Klasör</p>
            <p className="mt-1 text-xs text-zinc-400">
              Seçilen klasörü ve içindeki bütün alt klasörleri tarar.
            </p>
          </button>
        </div>

        {driveScanMode === 'folder' && (
          <div className="space-y-2">
            <label htmlFor="drive-root-folder-id" className="block text-xs font-semibold text-zinc-200">
              Google Drive klasör ID’si
            </label>
            <input
              id="drive-root-folder-id"
              type="text"
              value={driveFolderId}
              onChange={(event) => {
                setDriveFolderId(event.target.value);
                setScanSettingsSaved(false);
              }}
              placeholder="Örn: 1AbCdEfGhIjKlMnOp"
              className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-brand-500"
            />
            <p className="text-[11px] text-zinc-500">
              Drive klasörünü açıp URL’deki <span className="font-mono">/folders/</span> sonrasındaki değeri kopyalayın.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="drive-connection-id" className="block text-xs font-semibold text-zinc-200">
            Taranacak Google hesabı
          </label>
          <select
            id="drive-connection-id"
            value={driveConnectionId}
            onChange={(event) => {
              setDriveConnectionId(event.target.value);
              setScanSettingsSaved(false);
            }}
            className="w-full px-4 py-2.5 bg-zinc-950/80 border border-zinc-800 rounded-xl text-sm text-zinc-100 focus:outline-none focus:border-brand-500"
          >
            <option value="">Tüm bağlı Google hesapları</option>
            {allConnections.map((connection, index) => {
              const id = connection.id || '';
              const email = connection.email ||
                ('googleEmail' in connection ? connection.googleEmail : undefined) ||
                `Google Hesabı ${index + 1}`;
              return id ? <option key={id} value={id}>{email}</option> : null;
            })}
          </select>
          {driveScanMode === 'folder' && !driveConnectionId && allConnections.length > 1 && (
            <p className="text-[11px] text-amber-400">
              Klasör taramasında klasörün bağlı olduğu hesabı seçmeniz önerilir.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveScanSettings}
            disabled={
              !activeLibrary ||
              updateLibrary.isPending ||
              (driveScanMode === 'folder' && !driveFolderId.trim())
            }
            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-40"
          >
            {updateLibrary.isPending ? 'Kaydediliyor...' : 'Tarama Alanını Kaydet'}
          </button>
          {scanSettingsSaved && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              Kaydedildi
            </span>
          )}
          {updateLibrary.error && (
            <span className="text-xs text-red-400">{updateLibrary.error.message}</span>
          )}
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

      <AboutSettingsCard />
    </div>
  );
};

const AboutSettingsCard: React.FC = () => (
  <div id="settings-about" className="scroll-mt-24 border border-zinc-800/60 bg-zinc-900/30">
    <div className="flex items-center justify-between gap-4">
      <div>
        <h3 className="font-display text-sm font-bold text-white">CineDrive Hakkında</h3>
        <p className="mt-1 text-xs text-zinc-500">Kişisel Google Drive medya sunucusu</p>
      </div>
      <span className="rounded-md border border-white/[0.08] bg-zinc-950 px-2.5 py-1 text-[11px] font-semibold text-zinc-400">
        v1.0
      </span>
    </div>
  </div>
);

const LibraryVisibilitySettingsCard: React.FC = () => {
  const hideMoviesWithoutMetadata = useUiStore(
    (state) => state.hideMoviesWithoutMetadata,
  );
  const setHideMoviesWithoutMetadata = useUiStore(
    (state) => state.setHideMoviesWithoutMetadata,
  );

  return (
    <div id="settings-visibility" className="scroll-mt-24 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-5">
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
      name: 'CineDrive Cyan',
      desc: 'Modern Medya Merkezi',
      bgClass: 'bg-zinc-950',
      accentClass: 'bg-cyan-500',
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
    <div id="settings-appearance" className="scroll-mt-24 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
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
    <div id="settings-local-library" className="scroll-mt-24 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
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
    <div id="settings-opensubtitles" className="scroll-mt-24 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
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
      <div id="settings-database" className="scroll-mt-24 bg-rose-500/5 border border-rose-500/20 rounded-3xl p-6 md:p-8 space-y-6">
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
    <div id="settings-profile" className="scroll-mt-24 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
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
    <div id="settings-security" className="scroll-mt-24 bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
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
