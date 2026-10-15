import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  RememberBrowsedMedia,
  readRecentBrowse,
  recentBrowseKey,
  type BrowsedMedia,
} from '../hooks/useRecentlyBrowsed';
import { RecentlyBrowsed } from '../components/media/RecentlyBrowsed';
import { createTestQueryClient, seedSession } from './helpers/renderWithProviders';
import { useToastStore } from '../stores/useToastStore';
import { t } from '../i18n';

const movie: BrowsedMedia = { id: 'movie-1', title: 'Test film', type: 'movie' };
const key = recentBrowseKey('user-1');
function mount(media?: BrowsedMedia) {
  const client = createTestQueryClient();
  seedSession(client);
  const tree = (value?: BrowsedMedia) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {value && <RememberBrowsedMedia media={value} />}
        <RecentlyBrowsed />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(media));
  return { ...view, client, change: (value: BrowsedMedia) => view.rerender(tree(value)) };
}
beforeEach(() => {
  localStorage.clear();
  useToastStore.getState().clear();
});
afterEach(() => vi.restoreAllMocks());

it('records a detail, restores it on remount, and encodes the internal link', () => {
  const first = mount({ ...movie, id: 'id/with?query' });
  expect(screen.getByRole('link')).toHaveAttribute('href', '/media/id%2Fwith%3Fquery');
  first.unmount();
  mount();
  expect(screen.getByRole('link')).toHaveTextContent(movie.title);
});

it('keeps only 12 unique visits in most-recent-first order', () => {
  const view = mount(movie);
  for (let i = 0; i < 15; i++) view.change({ ...movie, id: `id-${i}`, title: `Film ${i}` });
  expect(readRecentBrowse(key)).toHaveLength(12);
  expect(readRecentBrowse(key)[0]?.id).toBe('id-14');
  view.change({ ...movie, id: 'id-5', title: 'Film 5' });
  expect(readRecentBrowse(key)).toHaveLength(12);
  expect(readRecentBrowse(key)[0]?.id).toBe('id-5');
});

it('removes one or all entries without a mounted recorder re-adding them', () => {
  const view = mount(movie);
  view.change({ id: 'series-1', title: 'Test series', type: 'series' });
  fireEvent.click(screen.getByRole('button', { name: t.recentBrowse.remove(movie.title) }));
  expect(screen.queryByText(movie.title)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: t.recentBrowse.clear }));
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(localStorage.getItem(key)).toBeNull();
});

it('isolates accounts and never copies a mounted old detail after switching account', async () => {
  const view = mount(movie);
  await act(async () => {
    view.client.setQueryData(['session'], { authenticated: true, user: { id: 'other' } });
  });
  await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
  expect(localStorage.getItem(recentBrowseKey('other'))).toBeNull();
  await act(async () => {
    seedSession(view.client);
  });
  expect(await screen.findByRole('link')).toHaveTextContent(movie.title);
  await act(async () => {
    view.client.setQueryData(['session'], { authenticated: false });
  });
  await waitFor(() => expect(screen.queryByRole('region')).not.toBeInTheDocument());
});

it.each(['null', 'broken', '[{"id":"bad","title":"Bad","type":"unsafe"}]', 'x'.repeat(16001)])(
  'discards malformed stored values',
  (raw) => {
    localStorage.setItem(key, raw);
    mount();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  },
);

it('reports failed removal and keeps the existing list visible', () => {
  mount(movie);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('denied');
  });
  fireEvent.click(screen.getByRole('button', { name: t.recentBrowse.clear }));
  expect(screen.getByRole('link')).toHaveTextContent(movie.title);
  expect(
    useToastStore.getState().toasts.some((item) => item.message === t.recentBrowse.clearFailed),
  ).toBe(true);
});

it('does not break the detail view when saving is denied', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  mount(movie);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});

it('responds to cross-tab removal and renders no empty section', () => {
  mount(movie);
  expect(within(screen.getByRole('region')).getAllByRole('link')).toHaveLength(1);
  localStorage.removeItem(key);
  act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
