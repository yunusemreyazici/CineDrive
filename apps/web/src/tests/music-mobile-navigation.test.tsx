import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { MusicSidebar } from '../components/music/MusicSidebar';
import { t } from '../i18n';
import { useUiStore } from '../stores/useUiStore';
import { renderWithProviders } from './helpers/renderWithProviders';

describe('mobile music navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { playlists: [] } });
    useUiStore.setState({ sidebarOpen: false });
    renderWithProviders(<MusicSidebar />, { route: '/music' });
  });

  it('opens the main CineDrive sidebar from the music header', () => {
    fireEvent.click(screen.getByRole('button', { name: t.nav.toggleMenu }));

    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });

  it('opens and closes the full music drawer', () => {
    const trigger = screen.getByRole('button', { name: t.music.musicNavigation });
    const drawer = document.querySelector(
      `aside[aria-label="${t.music.musicNavigation}"]`,
    ) as HTMLElement;

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(drawer).not.toHaveAttribute('aria-hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
  });
});
