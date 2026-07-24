import { useEffect, useRef } from 'react';

interface KeyboardShortcutHandlers {
  onTogglePlay: () => void;
  onSkipBackward: () => void;
  onSkipForward: () => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
  onToggleSubtitles: () => void;
  onSeekPercent: (percent: number) => void;
  onCloseMenu: () => void;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers, enabled = true) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not trigger hotkeys if user is typing in form controls
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isEditable = (document.activeElement as HTMLElement)?.isContentEditable;
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || isEditable) {
        return;
      }

      const h = handlersRef.current;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          h.onTogglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          h.onSkipBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          h.onSkipForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          h.onVolumeUp();
          break;
        case 'ArrowDown':
          e.preventDefault();
          h.onVolumeDown();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          h.onToggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          h.onToggleFullscreen();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          h.onTogglePiP();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          h.onToggleSubtitles();
          break;
        case 'Escape':
          e.preventDefault();
          h.onCloseMenu();
          break;
        default:
          if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            const percent = parseInt(e.key, 10) * 10;
            h.onSeekPercent(percent);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
