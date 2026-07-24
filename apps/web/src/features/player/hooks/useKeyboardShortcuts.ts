import { useEffect } from 'react';

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
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not trigger hotkeys if user is typing in form controls
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isEditable = (document.activeElement as HTMLElement)?.isContentEditable;
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || isEditable) {
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          handlers.onTogglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlers.onSkipBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handlers.onSkipForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          handlers.onVolumeUp();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handlers.onVolumeDown();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          handlers.onToggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          handlers.onToggleFullscreen();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          handlers.onTogglePiP();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          handlers.onToggleSubtitles();
          break;
        case 'Escape':
          e.preventDefault();
          handlers.onCloseMenu();
          break;
        default:
          if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            const percent = parseInt(e.key, 10) * 10;
            handlers.onSeekPercent(percent);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlers, enabled]);
}
