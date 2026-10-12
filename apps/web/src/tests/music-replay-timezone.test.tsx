import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { useMusicReplayQuery } from '../hooks/useMusicApi';

describe('Replay timezone contract', () => {
  it('sends the IANA timezone, legacy offset and cancellation signal', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: {} });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      renderHook(() => useMusicReplayQuery('year', 2015), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });
      await waitFor(() =>
        expect(get).toHaveBeenCalledWith('/music/replay', {
          params: {
            period: 'year',
            year: 2015,
            timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      get.mockRestore();
      queryClient.clear();
    }
  });
});
