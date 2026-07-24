import React from 'react';
import { Settings, ShieldCheck, RefreshCw, Unlink, ExternalLink, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  useGoogleStatusQuery,
  useUnlinkGoogleMutation,
  useLibrariesQuery,
  useScanLibraryMutation,
  useLibraryScansQuery,
} from '../hooks/useApi';

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
          <p className="text-sm text-zinc-400 mt-0.5">Google Drive entegrasyonu ve kütüphane tarama yönetimi</p>
        </div>
      </div>

      {/* Google Drive OAuth Section */}
      <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display text-white">Google Drive Bağlantısı</h3>
              <p className="text-xs text-zinc-400">OAuth 2.0 Salt Okunur Medya Erişimi</p>
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
            <div className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-2xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500 font-medium">Bağlı E-Posta:</span>
                <span className="text-zinc-200 font-semibold">{googleStatus.connection?.googleEmail || 'Bilinmiyor'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500 font-medium">Son İzin Tarihi:</span>
                <span className="text-zinc-200 font-semibold">
                  {googleStatus.connection?.updatedAt ? new Date(googleStatus.connection.updatedAt).toLocaleDateString('tr-TR') : '-'}
                </span>
              </div>
            </div>

            <button
              onClick={() => unlinkGoogle.mutate()}
              disabled={unlinkGoogle.isPending}
              className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold rounded-xl transition-colors"
            >
              <Unlink className="w-4 h-4" />
              Google Bağlantısını Kaldır
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-zinc-400 leading-relaxed">
              Google Drive hesabınızdaki medya klasörlerini tarayabilmek ve video akışını gerçekleştirebilmek için Google yetkilendirmesini tamamlamalısınız.
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
    </div>
  );
};
