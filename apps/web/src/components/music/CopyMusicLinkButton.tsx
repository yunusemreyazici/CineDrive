import { Link2 } from 'lucide-react';
import { toast } from '../../stores/useToastStore';
import { t } from '../../i18n';

/** Copies an authenticated detail URL, never a stream URL or a token. */
export function CopyMusicLinkButton({ kind, id }: { kind: 'tracks' | 'albums'; id: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/music/${kind}/${encodeURIComponent(id)}`,
      );
      toast.success(t.music.musicLinkCopied);
    } catch {
      toast.error(t.shortcuts.copyFailed);
    }
  };
  return (
    <button type="button" onClick={() => void copy()} className="cd-pill-link">
      <Link2 className="h-4 w-4" />
      {t.music.copyMusicLink}
    </button>
  );
}
