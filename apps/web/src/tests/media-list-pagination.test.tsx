import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { MoviesPage } from '../pages/MoviesPage';
import { SeriesPage } from '../pages/SeriesPage';
import { t } from '../i18n';
import { renderWithProviders } from './helpers/renderWithProviders';

describe('paginated media lists', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['movies', <MoviesPage />, 'movie'],
    ['series', <SeriesPage />, 'series'],
  ])(
    'returns %s to the last valid page when the catalogue shrinks',
    async (_name, pageView, type) => {
      let reduced = false;
      vi.spyOn(apiClient, 'get').mockImplementation(async (_path, config) => {
        const page = Number(config?.params?.page || 1);
        const title = reduced ? 'Remaining title' : page === 1 ? 'First title' : 'Old last title';
        return {
          data: {
            media:
              reduced && page > 1
                ? []
                : [
                    {
                      id: `item-${page}`,
                      type,
                      title,
                      normalizedTitle: title.toLowerCase(),
                      isFavorite: false,
                    },
                  ],
            pagination: { total: reduced ? 1 : 19, page, limit: 18, totalPages: reduced ? 1 : 2 },
          },
        } as never;
      });

      const { queryClient } = renderWithProviders(pageView);
      expect((await screen.findAllByText('First title')).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole('button', { name: t.library.nextPage }));
      expect((await screen.findAllByText('Old last title')).length).toBeGreaterThan(0);

      reduced = true;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ['media'] });
      });

      await waitFor(() => expect(screen.getAllByText('Remaining title').length).toBeGreaterThan(0));
      expect(screen.queryAllByText('Old last title')).toHaveLength(0);
    },
  );
});
