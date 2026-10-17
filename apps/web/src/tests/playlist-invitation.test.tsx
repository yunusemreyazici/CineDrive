import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../routes/AppRoutes';
import aasa from '../../public/.well-known/apple-app-site-association?raw';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const token = 'a'.repeat(43);
it('opens publicly without sending the fragment to an API or automatically accepting', async () => {
  const fetch = vi.spyOn(window, 'fetch');
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(
    <MemoryRouter initialEntries={[`/music/playlist-invite#${token}`]}>
      <AppRoutes />
    </MemoryRouter>,
  );
  const link = await screen.findByRole('link', { name: 'CineMusic’te aç' });
  const appURL = new URL(link.getAttribute('href')!);
  expect(appURL.protocol).toBe('cinemusic:');
  expect(appURL.hostname).toBe('playlist-invite');
  expect(appURL.searchParams.get('server')).toBe(window.location.origin);
  expect(appURL.hash).toBe(`#${token}`);
  fireEvent.click(screen.getByRole('button', { name: 'Bağlantıyı kopyala' }));
  await screen.findByText('Kopyalandı');
  expect(writeText).toHaveBeenCalledWith(
    `${window.location.origin}/music/playlist-invite#${token}`,
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects malformed fragments and associates the safe path with CineMusic', async () => {
  render(
    <MemoryRouter initialEntries={['/music/playlist-invite#bad']}>
      <AppRoutes />
    </MemoryRouter>,
  );
  await screen.findByText('Bu davet bağlantısı geçersiz. Gönderenden yeni bağlantı iste.');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(JSON.parse(aasa).applinks.details[0].components).toContainEqual(
    expect.objectContaining({ '/': '/music/playlist-invite' }),
  );
});
