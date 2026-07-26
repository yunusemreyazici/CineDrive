import { useEffect, type RefObject } from 'react';

type UseHlsPlaybackOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceUrl: string;
  active: boolean;
  onUnsupported: () => void;
  onFatalError: () => void;
};

export const useHlsPlayback = ({
  videoRef,
  sourceUrl,
  active,
  onUnsupported,
  onFatalError,
}: UseHlsPlaybackOptions) => {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || !sourceUrl) return;

    let disposed = false;
    let hls: import('hls.js').default | null = null;
    void import('hls.js').then(({ default: Hls }) => {
      if (disposed) return;
      if (!Hls.isSupported()) {
        onUnsupported();
        return;
      }

      hls = new Hls({
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(sourceUrl));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || disposed) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls?.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
          return;
        }
        onFatalError();
      });
    });

    return () => {
      disposed = true;
      hls?.destroy();
    };
  }, [active, onFatalError, onUnsupported, sourceUrl, videoRef]);
};
