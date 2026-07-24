import { create } from 'zustand';

export type ThemeType = 'default' | 'midnight' | 'neon' | 'emerald';

interface UiState {
  sidebarOpen: boolean;
  viewMode: 'grid' | 'list';
  theme: ThemeType;
  cinemaMode: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setTheme: (theme: ThemeType) => void;
  toggleCinemaMode: () => void;
  setCinemaMode: (enabled: boolean) => void;
}

const getInitialTheme = (): ThemeType => {
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem('cinedrive_theme');
      if (saved && ['default', 'midnight', 'neon', 'emerald'].includes(saved)) {
        return saved as ThemeType;
      }
    } catch {
      // Ignore storage access errors
    }
  }
  return 'default';
};

const applyThemeToDocument = (theme: ThemeType) => {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('cinedrive_theme', theme);
    } catch {
      // Ignore storage access errors
    }
  }
};

const initialTheme = getInitialTheme();
applyThemeToDocument(initialTheme);

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  viewMode: 'grid',
  theme: initialTheme,
  cinemaMode: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setTheme: (theme) => {
    applyThemeToDocument(theme);
    set({ theme });
  },
  toggleCinemaMode: () => set((state) => ({ cinemaMode: !state.cinemaMode })),
  setCinemaMode: (cinemaMode) => set({ cinemaMode }),
}));
