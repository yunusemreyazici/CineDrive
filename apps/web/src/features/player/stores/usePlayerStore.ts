import { create } from 'zustand';

const AUTO_PLAY_NEXT_STORAGE_KEY = 'cinedrive-auto-play-next-v1';

const getInitialAutoPlayNext = () => {
  try {
    return localStorage.getItem(AUTO_PLAY_NEXT_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

interface PlayerState {
  volume: number;
  isMuted: boolean;
  playbackSpeed: number;
  activeSubtitleId: string | null;
  autoPlayNext: boolean;
  subtitleDelay: number;
  subtitleFontSize: number;
  subtitleBgColor: 'transparent' | 'black' | 'shadow';
  setVolume: (volume: number) => void;
  setIsMuted: (muted: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setActiveSubtitleId: (id: string | null) => void;
  setAutoPlayNext: (autoPlay: boolean) => void;
  setSubtitleDelay: (delay: number) => void;
  setSubtitleFontSize: (size: number) => void;
  setSubtitleBgColor: (bgColor: 'transparent' | 'black' | 'shadow') => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  volume: 1,
  isMuted: false,
  playbackSpeed: 1,
  activeSubtitleId: null,
  autoPlayNext: getInitialAutoPlayNext(),
  subtitleDelay: 0,
  subtitleFontSize: 100,
  subtitleBgColor: 'black',
  setVolume: (volume) => set({ volume, isMuted: volume === 0 }),
  setIsMuted: (isMuted) => set({ isMuted }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setActiveSubtitleId: (activeSubtitleId) => set({ activeSubtitleId }),
  setAutoPlayNext: (autoPlayNext) => {
    try {
      localStorage.setItem(AUTO_PLAY_NEXT_STORAGE_KEY, String(autoPlayNext));
    } catch {
      // Keep the preference in memory if storage is unavailable.
    }
    set({ autoPlayNext });
  },
  setSubtitleDelay: (subtitleDelay) => set({ subtitleDelay }),
  setSubtitleFontSize: (subtitleFontSize) => set({ subtitleFontSize }),
  setSubtitleBgColor: (subtitleBgColor) => set({ subtitleBgColor }),
}));
