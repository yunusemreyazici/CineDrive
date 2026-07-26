import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { apiClient } from '../api/client';
import { LibraryPage } from '../pages/LibraryPage';
import { t } from '../i18n';
import { renderWithProviders } from './helpers/renderWithProviders';

const emptyResponse = {
  data: { media: [], pagination: { total: 0, page: 1, limit: 18, totalPages: 0 } },
};

describe('LibraryPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a retryable error instead of an empty state when the request fails', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockRejectedValue({
      isAxiosError: true,
      response: { status: 500, data: { error: { message: 'Sunucu hatası' } } },
    });

    renderWithProviders(<LibraryPage />, { route: '/library' });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(t.library.loadFailed)).toBeInTheDocument();
    expect(screen.getByText('Sunucu hatası')).toBeInTheDocument();
    // The misleading "no media found" empty state must not appear.
    expect(screen.queryByText(t.library.notFoundTitle)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: t.common.retry }));
    await waitFor(() => expect(getSpy.mock.calls.length).toBeGreaterThan(1));
  });

  it('shows the empty state when the library genuinely has no matches', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue(emptyResponse as never);

    renderWithProviders(<LibraryPage />, { route: '/library' });

    expect(await screen.findByText(t.library.notFoundTitle)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('debounces the search input into a single request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue(emptyResponse as never);

    renderWithProviders(<LibraryPage />, { route: '/library' });
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    const callsAfterMount = getSpy.mock.calls.length;

    const input = screen.getByLabelText(t.library.searchLabel);
    for (const value of ['m', 'ma', 'mat', 'matr', 'matri', 'matrix']) {
      fireEvent.change(input, { target: { value } });
    }

    // Nothing goes out while the user is still typing.
    expect(getSpy.mock.calls.length).toBe(callsAfterMount);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await waitFor(() => {
      const searchCalls = getSpy.mock.calls.filter(
        ([, config]) =>
          (config as { params?: { search?: string } } | undefined)?.params?.search === 'matrix',
      );
      expect(searchCalls).toHaveLength(1);
    });
  });
});
