import React from 'react';
import { Youtube } from 'lucide-react';
import { Modal } from '../common/Modal';
import { extractYoutubeId } from '../../utils/youtube';
import { t } from '../../i18n';

interface TrailerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  trailerUrl?: string | null;
}

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
          <Youtube className="h-5 w-5 fill-current" />
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
            <Youtube className="h-12 w-12 text-zinc-600" />
            <p className="text-sm font-medium">
              {t.trailer.unavailable}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};
