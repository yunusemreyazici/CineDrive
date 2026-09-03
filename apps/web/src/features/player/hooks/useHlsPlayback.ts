import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { createHlsRecovery } from '../utils/hlsRecovery';

const noop = () => {};

type UseHlsPlaybackOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceUrl: string;
  active: boolean;
  native?: boolean;
  onUnsupported: () => void;
  onFatalError: () => void;
  onRecovering?: (attempt: number, max: number) => void;
  onRecovered?: () => void;
};

export const useHlsPlayback = ({
  videoRef,
  sourceUrl,
  active,
  native = false,
  onUnsupported,
  onFatalError,
  onRecovering = noop,
  onRecovered = noop,
}: UseHlsPlaybackOptions) => {
  const recoveryRef = useRef<ReturnType<typeof createHlsRecovery> | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || !sourceUrl) return;

    let disposed = false;
    let hls: import('hls.js').default | null = null;
    const recovery = createHlsRecovery({
      video,
      onRecovering,
      onRecovered,
      onFatalError,
      stop: (terminal) => {
        hls?.stopLoad();
        if (native && terminal) {
          video.removeAttribute('src');
          video.load();
        }
      },
      reload: (kind, position) => {
        if (native) {
          video.src = sourceUrl;
          video.load();
        } else if (kind === 'media') {
          hls?.recoverMediaError();
        } else if (!hls?.levels.length) {
          // A failed first manifest has no level for startLoad() to restart.
          hls?.loadSource(sourceUrl);
        } else {
          hls.startLoad(position);
        }
      },
    });
    recoveryRef.current = recovery;
    const nativeReady = () => {
      if (native) recovery.dataReceived();
    };
    video.addEventListener('canplay', nativeReady);
    const setup = async () => {
      if (native) return;
      const { default: Hls } = await import('hls.js');
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
      hls.on(Hls.Events.FRAG_BUFFERED, () => recovery.dataReceived());
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || disposed) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if ([401, 403].includes(data.response?.code ?? 0)) recovery.fail();
          else recovery.requestRecovery('network');
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          recovery.requestRecovery('media');
          return;
        }
        recovery.fail();
      });
    };
    void setup().catch(() => {
      if (!disposed) recovery.fail();
    });

    return () => {
      disposed = true;
      recovery.destroy();
      recoveryRef.current = null;
      video.removeEventListener('canplay', nativeReady);
      hls?.destroy();
    };
  }, [active, native, onFatalError, onUnsupported, onRecovering, onRecovered, sourceUrl, videoRef]);

  const retry = useCallback(() => recoveryRef.current?.retry(), []);
  const setPlaybackIntent = useCallback(
    (playing: boolean) => recoveryRef.current?.setPlaybackIntent(playing),
    [],
  );
  const handleLoadedMetadata = useCallback(
    () => recoveryRef.current?.handleLoadedMetadata() ?? false,
    [],
  );
  const handleSourceError = useCallback(
    () =>
      recoveryRef.current?.requestRecovery(
        videoRef.current?.error?.code === 2 ? 'network' : 'media',
      ),
    [videoRef],
  );
  const getRecoveryPosition = useCallback(
    () => recoveryRef.current?.getRecoveryPosition() ?? null,
    [],
  );
  return { retry, setPlaybackIntent, handleLoadedMetadata, handleSourceError, getRecoveryPosition };
};
