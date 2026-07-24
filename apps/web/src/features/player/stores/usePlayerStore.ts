import { create } from 'zustand';

interface PlayerState {
  volume: number;
  isMuted: boolean;
  playbackSpeed: number;
  activeSubtitleId: string | null;
  autoPlayNext: boolean;
  setVolume: (volume: number) => void;
  setIsMuted: (muted: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setActiveSubtitleId: (id: string | null) => void;
  setAutoPlayNext: (autoPlay: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  volume: 1,
  isMuted: false,
  playbackSpeed: 1,
  activeSubtitleId: null,
  autoPlayNext: true,
  setVolume: (volume) => set({ volume, isMuted: volume === 0 }),
  setIsMuted: (isMuted) => set({ isMuted }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setActiveSubtitleId: (activeSubtitleId) => set({ activeSubtitleId }),
  setAutoPlayNext: (autoPlayNext) => set({ autoPlayNext }),
}));
