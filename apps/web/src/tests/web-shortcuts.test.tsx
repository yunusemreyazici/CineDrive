import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { LibraryPage } from '../pages/LibraryPage';
import { MoviesPage } from '../pages/MoviesPage';
import { SearchDialog } from '../components/search/SearchDialog';
import { useBrowserShortcuts } from '../hooks/useBrowserShortcuts';
import { shortcutsKey, rememberSearch } from '../utils/browserShortcuts';
import { createTestQueryClient, seedSession } from './helpers/renderWithProviders';
import { render } from '@testing-library/react';
import { t } from '../i18n';
import { useToastStore } from '../stores/useToastStore';

const emptyMedia = {
  data: { media: [], pagination: { total: 0, page: 1, limit: 18, totalPages: 0 } },
};
function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="location">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate('/library')}>Go library</button>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}
function mount(element: React.ReactNode, route = '/library') {
  const client = createTestQueryClient();
  seedSession(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          {element}
          <Navigation />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(apiClient, 'get').mockResolvedValue(emptyMedia as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useToastStore.getState().clear();
});

describe('catalogue views', () => {
  it('merges consecutive facet edits before router transitions commit', async () => {
    mount(<MoviesPage />);
    const year = screen.getByLabelText(t.filters.yearRange);
    const rating = screen.getByLabelText(t.filters.minRating);
    act(() => {
      fireEvent.change(year, { target: { value: '2000s' } });
      fireEvent.change(rating, { target: { value: '8.0' } });
    });
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        '/media',
        expect.objectContaining({
          params: expect.objectContaining({ yearFrom: 2000, yearTo: 2009, minRating: 8 }),
        }),
      ),
    );
    expect(screen.getByLabelText(t.filters.yearRange)).toHaveValue('2000s');
    expect(screen.getByLabelText(t.filters.minRating)).toHaveValue('8.0');
  });

  it('preserves descending year sort when the default direction is omitted', async () => {
    mount(<MoviesPage />, '/movies?sortBy=year');
    expect(screen.getByLabelText(t.filters.sortBy)).toHaveValue('year:desc');
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        '/media',
        expect.objectContaining({
          params: expect.objectContaining({ sortBy: 'year', sortOrder: 'desc' }),
        }),
      ),
    );
  });

  it('copies a canonical filter link and reports clipboard failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    mount(<LibraryPage />, '/library?genre=Dram&yearRange=2000s&page=9&unrecognized=value');
    fireEvent.click(screen.getByRole('button', { name: t.shortcuts.copyLink }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/library?genre=Dram&yearRange=2000s`,
      ),
    );
    writeText.mockRejectedValue(new Error('Permission denied'));
    fireEvent.click(screen.getByRole('button', { name: t.shortcuts.copyLink }));
    await waitFor(() =>
      expect(
        useToastStore.getState().toasts.some((item) => item.message === t.shortcuts.copyFailed),
      ).toBe(true),
    );
  });

  it('restores validated URL filters and resets the page when a facet changes', async () => {
    mount(
      <LibraryPage />,
      '/library?type=movie&genre=Dram&minRating=8&yearRange=2000s&sortBy=title&sortOrder=asc&page=3',
    );
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        '/media',
        expect.objectContaining({
          params: expect.objectContaining({
            type: 'movie',
            genre: 'Dram',
            minRating: 8,
            yearFrom: 2000,
            yearTo: 2009,
            sortBy: 'title',
            sortOrder: 'asc',
            page: 3,
          }),
        }),
      ),
    );
    fireEvent.click(screen.getByLabelText(t.filters.toggleLabel));
    expect(screen.getByLabelText(t.filters.yearRange)).toHaveValue('2000s');
    fireEvent.change(screen.getByLabelText(t.filters.minRating), { target: { value: '7.0' } });
    expect(screen.getByLabelText('location')).toHaveTextContent('minRating=7');
    expect(screen.getByLabelText('location').textContent).not.toContain('page=3');
    fireEvent.click(screen.getByText('Back'));
    await waitFor(() => expect(screen.getByLabelText(t.filters.minRating)).toHaveValue('8.0'));
  });

  it('clears every facet from the no-results action', async () => {
    mount(<LibraryPage />, '/library?genre=Dram&minRating=8&yearRange=classics');
    fireEvent.click(await screen.findByRole('button', { name: t.library.clearFilters }));
    await waitFor(() => expect(screen.getByLabelText('location').textContent).toBe('/library'));
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenLastCalledWith(
        '/media',
        expect.objectContaining({
          params: expect.objectContaining({ genre: undefined, minRating: undefined, page: 1 }),
        }),
      ),
    );
  });

  it('persists a named view, reapplies it after remount, and isolates accounts', async () => {
    const first = mount(<MoviesPage />, '/movies?genre=Dram&yearRange=classics&minRating=8&page=4');
    fireEvent.click(screen.getByRole('button', { name: t.shortcuts.saveView }));
    const modal = screen.getByRole('dialog');
    fireEvent.change(within(modal).getByLabelText(t.shortcuts.viewName), {
      target: { value: 'My classics' },
    });
    fireEvent.submit(within(modal).getByRole('button', { name: t.common.save }).closest('form')!);
    expect(screen.getByRole('button', { name: 'My classics' })).toBeInTheDocument();
    first.unmount();
    const second = mount(<LibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'My classics' }));
    expect(screen.getByLabelText('location')).toHaveTextContent(
      '/movies?genre=Dram&minRating=8&yearRange=classics',
    );
    expect(screen.getByLabelText('location').textContent).not.toContain('page=');
    await act(async () => {
      second.client.setQueryData(['session'], { authenticated: true, user: { id: 'other-user' } });
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'My classics' })).not.toBeInTheDocument(),
    );
    await act(async () => {
      seedSession(second.client);
    });
    fireEvent.click(
      await screen.findByRole('button', { name: t.shortcuts.removeView('My classics') }),
    );
    expect(screen.queryByRole('button', { name: 'My classics' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(shortcutsKey('user-1'))!).views).toEqual([]);
  });

  it('shows storage failure without claiming the view was saved', () => {
    mount(<LibraryPage />);
    fireEvent.click(screen.getByRole('button', { name: t.shortcuts.saveView }));
    const modal = screen.getByRole('dialog');
    fireEvent.change(within(modal).getByLabelText(t.shortcuts.viewName), {
      target: { value: 'Unavailable' },
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.submit(within(modal).getByRole('button', { name: t.common.save }).closest('form')!);
    expect(within(modal).getByRole('alert')).toHaveTextContent(t.shortcuts.storageFailed);
    expect(screen.queryByRole('button', { name: 'Unavailable' })).not.toBeInTheDocument();
  });

  it('rejects persisted links outside known catalogue routes and invalid URL facets', async () => {
    localStorage.setItem(
      shortcutsKey('user-1'),
      JSON.stringify({
        searches: [],
        views: [{ id: 'bad', name: 'Untrusted', path: '//evil.test', query: '' }],
      }),
    );
    mount(
      <LibraryPage />,
      '/library?type=sql&minRating=100&sortBy=unsafe&sortOrder=down&yearRange=anything&page=-2',
    );
    expect(screen.queryByRole('button', { name: 'Untrusted' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        '/media',
        expect.objectContaining({
          params: expect.objectContaining({
            type: undefined,
            minRating: undefined,
            sortBy: 'createdAt',
            sortOrder: 'desc',
            page: 1,
          }),
        }),
      ),
    );
  });
});

describe('search shortcuts', () => {
  it('navigates from the empty palette without issuing catalogue searches', () => {
    mount(<SearchDialog onClose={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByLabelText('location').textContent).toBe('/movies');
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('records only an explicitly submitted term, including Enter before debounce', () => {
    const first = mount(<SearchDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '  Matrix  ' } });
    expect(localStorage.getItem(shortcutsKey('user-1'))).toBeNull();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByLabelText('location').textContent).toBe('/library?search=Matrix');
    first.unmount();
    mount(<SearchDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t.shortcuts.searchAgain('Matrix') }));
    expect(screen.getByRole('combobox')).toHaveValue('Matrix');
  });

  it('bounds recent searches and updates mounted consumers without exposing another account', async () => {
    function Probe() {
      const { data, update } = useBrowserShortcuts();
      return (
        <>
          <output aria-label="searches">{data.searches.join(',')}</output>
          <button
            onClick={() =>
              update((current) =>
                Array.from({ length: 12 }, (_, index) => `term${index}`).reduce(
                  rememberSearch,
                  current,
                ),
              )
            }
          >
            Fill history
          </button>
        </>
      );
    }
    const { client } = mount(
      <>
        <Probe />
        <SearchDialog onClose={vi.fn()} />
      </>,
    );
    fireEvent.click(screen.getByText('Fill history'));
    expect(screen.getAllByRole('button', { name: /aramasını tekrarla/ })).toHaveLength(8);
    await act(async () => {
      client.setQueryData(['session'], { authenticated: true, user: { id: 'second-user' } });
    });
    await waitFor(() =>
      expect(screen.queryAllByRole('button', { name: /aramasını tekrarla/ })).toHaveLength(0),
    );
    await act(async () => {
      seedSession(client);
    });
    fireEvent.click(await screen.findByRole('button', { name: t.shortcuts.clearSearches }));
    expect(screen.getByLabelText('searches')).toHaveTextContent('');
  });
});
