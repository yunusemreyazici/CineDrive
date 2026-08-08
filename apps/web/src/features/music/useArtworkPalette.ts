import { useCallback, useEffect, useSyncExternalStore } from 'react';

export interface ArtworkPalette {
  primary: string;
  secondary: string;
  glow: string;
}

const FALLBACK_PALETTE: ArtworkPalette = {
  primary: '23 32 42',
  secondary: '7 8 9',
  glow: '0 173 181',
};
const cache = new Map<string, ArtworkPalette>();
const loading = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

const notify = (url: string) => listeners.get(url)?.forEach((listener) => listener());

const loadPalette = (url: string) => {
  if (cache.has(url) || loading.has(url) || typeof Image === 'undefined') return;
  loading.add(url);
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 24, 24);
      const pixels = context.getImageData(0, 0, 24, 24).data;
      const colors: Array<{ r: number; g: number; b: number; score: number }> = [];
      for (let index = 0; index < pixels.length; index += 16) {
        const r = pixels[index] || 0;
        const g = pixels[index + 1] || 0;
        const b = pixels[index + 2] || 0;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max - min;
        const brightness = (r + g + b) / 3;
        if (brightness < 22 || brightness > 235) continue;
        colors.push({ r, g, b, score: saturation * 1.6 + Math.min(brightness, 180) });
      }
      colors.sort((left, right) => right.score - left.score);
      const primary = colors[0] || { r: 23, g: 32, b: 42 };
      const secondary =
        colors.find(
          (color) =>
            Math.abs(color.r - primary.r) +
              Math.abs(color.g - primary.g) +
              Math.abs(color.b - primary.b) >
            90,
        ) ||
        colors[Math.min(8, colors.length - 1)] ||
        primary;
      cache.set(url, {
        primary: `${primary.r} ${primary.g} ${primary.b}`,
        secondary: `${secondary.r} ${secondary.g} ${secondary.b}`,
        glow: `${Math.min(255, primary.r + 28)} ${Math.min(255, primary.g + 28)} ${Math.min(255, primary.b + 28)}`,
      });
    } catch {
      cache.set(url, FALLBACK_PALETTE);
    } finally {
      loading.delete(url);
      notify(url);
    }
  };
  image.onerror = () => {
    loading.delete(url);
    cache.set(url, FALLBACK_PALETTE);
    notify(url);
  };
  image.src = url;
};

export const useArtworkPalette = (url?: string | null) => {
  const key = url || '';
  useEffect(() => {
    if (key) loadPalette(key);
  }, [key]);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return () => undefined;
      const entries = listeners.get(key) || new Set<() => void>();
      entries.add(listener);
      listeners.set(key, entries);
      return () => {
        entries.delete(listener);
        if (!entries.size) listeners.delete(key);
      };
    },
    [key],
  );
  const getSnapshot = useCallback(() => cache.get(key) || FALLBACK_PALETTE, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => FALLBACK_PALETTE);
};
