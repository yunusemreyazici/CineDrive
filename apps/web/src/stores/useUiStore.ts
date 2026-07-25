import { create } from 'zustand';

export type ThemeType = 'default' | 'midnight' | 'neon' | 'emerald';

interface UiState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  viewMode: 'grid' | 'list';
  theme: ThemeType;
  cinemaMode: boolean;
  hideMoviesWithoutMetadata: boolean;
  toggleSidebar: () => void;
  toggleSidebarCollapsed: () => void;
  setSidebarOpen: (open: boolean) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  setTheme: (theme: ThemeType) => void;
  setHideMoviesWithoutMetadata: (hidden: boolean) => void;
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

const getInitialHideMoviesWithoutMetadata = () => {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem('cinedrive_hide_movies_without_metadata') === 'true';
  } catch {
    return false;
  }
};

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  sidebarCollapsed: false,
  viewMode: 'grid',
  theme: initialTheme,
  cinemaMode: false,
  hideMoviesWithoutMetadata: getInitialHideMoviesWithoutMetadata(),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setTheme: (theme) => {
    applyThemeToDocument(theme);
    set({ theme });
  },
  setHideMoviesWithoutMetadata: (hideMoviesWithoutMetadata) => {
    try {
      localStorage.setItem(
        'cinedrive_hide_movies_without_metadata',
        String(hideMoviesWithoutMetadata),
      );
    } catch {
      // The in-memory preference still works when storage is unavailable.
    }
    set({ hideMoviesWithoutMetadata });
  },
  toggleCinemaMode: () => set((state) => ({ cinemaMode: !state.cinemaMode })),
  setCinemaMode: (cinemaMode) => set({ cinemaMode }),
}));
