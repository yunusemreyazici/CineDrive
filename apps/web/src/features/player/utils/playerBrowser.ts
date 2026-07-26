/**
 * Browser capability probes for the player. These live outside the component
 * so they can be unit-tested with synthetic user agents and so the component
 * file only exports a component.
 */

export const isSafariBrowser = (
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
  maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
) => {
  // Chrome, Firefox and Edge on iOS are Safari/WebKit under the hood and need
  // the same native HLS compatibility path. Their branded user-agent tokens
  // must not route MKV files through the desktop Chromium strategy.
  const isAppleMobileWebKit =
    /iPad|iPhone|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (isAppleMobileWebKit) return true;

  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(userAgent);
};

export const getBrowserFamily = (isSafari: boolean) => {
  if (isSafari) return 'safari' as const;
  return /Chrome|Chromium|CriOS|Edg/i.test(navigator.userAgent)
    ? ('chromium' as const)
    : ('other' as const);
};

export const getBufferedAheadSeconds = (video: HTMLVideoElement) => {
  for (let index = 0; index < video.buffered.length; index++) {
    const start = video.buffered.start(index);
    const end = video.buffered.end(index);
    if (video.currentTime >= start - 0.05 && video.currentTime <= end) {
      return Math.max(0, end - video.currentTime);
    }
  }
  return 0;
};

type WebkitFullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

type WebkitFullscreenDocument = Document & {
  webkitExitFullscreen?: () => void;
  webkitFullscreenElement?: Element | null;
};

export const togglePlayerFullscreen = async (video: HTMLVideoElement, container: HTMLElement) => {
  const fullscreenDocument = document as WebkitFullscreenDocument;
  const webkitVideo = video as WebkitFullscreenVideo;

  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return 'exited' as const;
  }

  if (fullscreenDocument.webkitFullscreenElement) {
    fullscreenDocument.webkitExitFullscreen?.();
    return 'exited' as const;
  }

  if (webkitVideo.webkitDisplayingFullscreen) {
    webkitVideo.webkitExitFullscreen?.();
    return 'exited' as const;
  }

  // iPhone Safari does not expose the standard Fullscreen API for arbitrary
  // elements. Its native video fullscreen method must run directly inside the
  // user gesture, so use it before any asynchronous fallback.
  if (!container.requestFullscreen && webkitVideo.webkitEnterFullscreen) {
    webkitVideo.webkitEnterFullscreen();
    return 'native-video' as const;
  }

  if (container.requestFullscreen) {
    try {
      await container.requestFullscreen();
      return 'container' as const;
    } catch {
      if (webkitVideo.webkitEnterFullscreen) {
        webkitVideo.webkitEnterFullscreen();
        return 'native-video' as const;
      }
      throw new Error('FULLSCREEN_NOT_SUPPORTED');
    }
  }

  if (video.requestFullscreen) {
    await video.requestFullscreen();
    return 'video' as const;
  }

  if (webkitVideo.webkitEnterFullscreen) {
    webkitVideo.webkitEnterFullscreen();
    return 'native-video' as const;
  }

  throw new Error('FULLSCREEN_NOT_SUPPORTED');
};

/**
 * Picks a starting quality from the network and device hints the browser
 * exposes, capped by the source resolution so we never upscale.
 */
export const chooseAutoQuality = (sourceHeight?: number) => {
  const navigatorWithHints = navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
    deviceMemory?: number;
  };
  const connection = navigatorWithHints.connection;
  const deviceMemory = navigatorWithHints.deviceMemory;

  let quality: '1080p' | '720p' | '480p' =
    connection?.saveData || connection?.effectiveType === '2g'
      ? '480p'
      : connection?.effectiveType === '3g' || (deviceMemory !== undefined && deviceMemory <= 4)
        ? '720p'
        : '1080p';

  if (sourceHeight && sourceHeight <= 480) quality = '480p';
  else if (sourceHeight && sourceHeight <= 720 && quality === '1080p') quality = '720p';
  return quality;
};
