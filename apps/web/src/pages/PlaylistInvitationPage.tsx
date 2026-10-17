import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { locale } from '../i18n';

const messages = {
  tr: {
    title: 'Birlikte bir playlist hazırlayın',
    description: 'Parçaları aynı listeye ekleyin, kendi cihazlarınızda bağımsız dinleyin.',
    open: 'CineMusic’te aç',
    copy: 'Bağlantıyı kopyala',
    copied: 'Kopyalandı',
    failed: 'Kopyalanamadı. Tarayıcının adres çubuğundaki bağlantıyı kopyalayabilirsin.',
    invalid: 'Bu davet bağlantısı geçersiz. Gönderenden yeni bağlantı iste.',
    help: 'Uygulama açılmazsa bağlantıyı CineMusic → Kütüphane → Playlist’ler → Playlist davetleri bölümüne yapıştır.',
    permission:
      'Aynı sunucudaki hesabınla giriş yapman gerekir. Uygulama davetin süresini kontrol eder ve katılmadan önce onayını ister. Özel kütüphanelere erişim verilmez. Bu sayfayı açmak listeye katılmaz veya müzik başlatmaz.',
  },
  en: {
    title: 'Make a playlist together',
    description: 'Add tracks to the same playlist and listen independently on your own devices.',
    open: 'Open in CineMusic',
    copy: 'Copy link',
    copied: 'Copied',
    failed: 'Could not copy. Copy the link from your browser’s address bar.',
    invalid: 'This invitation is invalid. Ask the sender for a new link.',
    help: 'If the app does not open, paste the link in CineMusic → Library → Playlists → Playlist invitations.',
    permission:
      'Sign in on the same server. The app checks expiry and asks you to confirm before joining. Private library access is not granted. Opening this page does not join a playlist or start playback.',
  },
};

export function PlaylistInvitationPage() {
  const location = useLocation();
  const token = location.hash.slice(1);
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const text = messages[locale];
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const basePath = location.pathname.replace(/\/music\/playlist-invite\/?$/, '');
  const server = `${window.location.origin}${basePath}`;
  const canonical = `${server}/music/playlist-invite#${token}`;
  const appURL = `cinemusic://playlist-invite?${new URLSearchParams({ server })}#${token}`;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(canonical);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-12 text-zinc-100">
      <section className="cd-utility w-full max-w-lg space-y-6">
        <p className="text-sm font-semibold tracking-wide text-brand-400">CineMusic</p>
        <h1 className="text-3xl font-bold">{valid ? text.title : text.invalid}</h1>
        {valid && (
          <>
            <p>{text.description}</p>
            <p className="break-all text-sm text-zinc-400">{server}</p>
            <div className="flex flex-wrap gap-3">
              <a
                href={appURL}
                referrerPolicy="no-referrer"
                className="rounded-xl bg-brand-500 px-5 py-3 font-semibold text-white"
              >
                {text.open}
              </a>
              <button
                type="button"
                className="rounded-xl border border-white/20 px-5 py-3"
                onClick={() => void copyLink()}
              >
                {text.copy}
              </button>
            </div>
            <p role="status">{copyState === 'idle' ? '' : text[copyState]}</p>
            <p className="text-sm text-zinc-300">{text.help}</p>
            <p className="border-t border-white/10 pt-5 text-sm text-zinc-400">{text.permission}</p>
          </>
        )}
      </section>
    </main>
  );
}
