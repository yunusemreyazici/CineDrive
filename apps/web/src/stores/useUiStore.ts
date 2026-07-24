import { create } from 'zustand';

interface UiState {
  sidebarOpen: boolean;
  viewMode: 'grid' | 'list';
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  viewMode: 'grid',
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setViewMode: (mode) => set({ viewMode: mode }),
}));
