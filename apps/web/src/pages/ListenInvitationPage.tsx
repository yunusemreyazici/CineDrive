import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { locale } from '../i18n';

const messages = {
  tr: {
    title: 'Birlikte dinlemeye davetlisin',
    description: 'CineMusic’te ortak kuyruğa katıl, kendi cihazından aynı müziği dinle.',
    open: 'CineMusic’te aç',
    copy: 'Kodu kopyala',
    copied: 'Kopyalandı',
    copyFailed: 'Kopyalanamadı. Kodu seçip elle kopyalayabilirsin.',
    instructions: 'Uygulama açılmazsa CineMusic → Connect → Birlikte Dinle bölümüne bu kodu gir.',
    permission:
      'Bu sunucuda kendi hesabınla giriş yapmalısın. Davet, müziklere erişim izni vermez. Oturum kapanmışsa veya kod yenilenmişse uygulama katılırken bunu belirtir.',
    missing: 'CineMusic yüklü değilse uygulamayı yükledikten sonra bu bağlantıya geri dön.',
    invalid: 'Bu davet bağlantısı geçersiz.',
    request: 'Gönderenden yeni bir davet bağlantısı iste.',
    server: 'Sunucu',
  },
  en: {
    title: 'You’re invited to listen together',
    description: 'Join a shared queue in CineMusic and listen on your own device.',
    open: 'Open in CineMusic',
    copy: 'Copy code',
    copied: 'Copied',
    copyFailed: 'Could not copy. Select the code and copy it manually.',
    instructions:
      'If the app does not open, enter this code in CineMusic → Connect → Listen Together.',
    permission:
      'Sign in to this server with your own account. An invitation does not grant access to music. The app checks whether the session and code are still valid when you join.',
    missing: 'If CineMusic is not installed, return to this link after installing the app.',
    invalid: 'This invitation link is invalid.',
    request: 'Ask the sender for a new invitation link.',
    server: 'Server',
  },
};

export function ListenInvitationPage() {
  const { code = '' } = useParams();
  const text = messages[locale];
  const valid = /^[A-Fa-f0-9]{16}$/.test(code);
  const canonicalCode = code.toUpperCase();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const canonical = new URL(
    `/music/listen/${encodeURIComponent(canonicalCode)}`,
    window.location.origin,
  );
  const appURL = `cinemusic://listen?${new URLSearchParams({ url: canonical.href })}`;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(canonicalCode);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-12 text-zinc-100">
      <section className="w-full max-w-lg space-y-6 rounded-3xl border border-white/10 bg-zinc-900 p-8 shadow-xl">
        <p className="text-sm font-semibold tracking-wide text-brand-400">CineMusic</p>
        <h1 className="text-3xl font-bold">{valid ? text.title : text.invalid}</h1>
        {!valid ? (
          <p className="text-zinc-300">{text.request}</p>
        ) : (
          <>
            <p className="text-zinc-300">{text.description}</p>
            <div className="space-y-3 rounded-xl bg-black/20 p-4">
              <p className="break-all text-sm text-zinc-400">
                {text.server}: {window.location.origin}
              </p>
              <p
                className="select-all break-all font-mono text-2xl font-semibold"
                data-testid="invitation-code"
              >
                {canonicalCode}
              </p>
            </div>
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
                onClick={() => void copyCode()}
                className="rounded-xl border border-white/20 px-5 py-3"
              >
                {text.copy}
              </button>
            </div>
            <p role="status" className="text-sm text-zinc-300">
              {copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : ''}
            </p>
            <p className="text-sm text-zinc-300">{text.instructions}</p>
            <p className="text-sm text-zinc-400">{text.missing}</p>
            <p className="border-t border-white/10 pt-5 text-sm text-zinc-400">{text.permission}</p>
          </>
        )}
      </section>
    </main>
  );
}
