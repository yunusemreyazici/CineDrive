import React from 'react';
import { Modal } from '../common/Modal';
import { extractYoutubeId } from '../../utils/youtube';
import { t } from '../../i18n';

interface TrailerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  trailerUrl?: string | null;
}

/** Lucide removed brand icons in v1, so the YouTube play mark is inlined. */
const YoutubeLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

export const TrailerModal: React.FC<TrailerModalProps> = ({
  isOpen,
  onClose,
  title,
  trailerUrl,
}) => {
  const youtubeId = extractYoutubeId(trailerUrl);
  const embedUrl = youtubeId
    ? `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1`
    : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={t.trailer.label(title)}
      icon={
        <div className="rounded-xl bg-red-600/20 p-2 text-red-500">
          <YoutubeLogo className="h-5 w-5" />
        </div>
      }
    >
      <div className="relative flex aspect-video w-full items-center justify-center bg-black">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title={t.trailer.iframeTitle(title)}
            className="h-full w-full border-0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-zinc-500">
            <YoutubeLogo className="h-12 w-12 text-zinc-600" />
            <p className="text-sm font-medium">
              {t.trailer.unavailable}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};
