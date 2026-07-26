import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppRoutes } from '../routes/AppRoutes';

const renderAtPath = (path: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Skip the network round trip for the session guard.
  queryClient.setQueryData(['session'], {
    authenticated: true,
    user: { id: 'user-1', email: 'test@cinedrive.local', name: 'Test' },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Unmatched routes', () => {
  it('renders the not found page inside the app shell', async () => {
    renderAtPath('/bilinmeyen-bir-adres');

    expect(await screen.findByText('404')).toBeInTheDocument();
    expect(screen.getByText('Sayfa Bulunamadı')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Kütüphaneye Dön/ })).toBeInTheDocument();
    // The shell stays mounted so the user can navigate away. (The sidebar nav
    // is aria-hidden at mobile widths, so the header is the stable landmark.)
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('does not hijack a known route', async () => {
    renderAtPath('/favorites');

    expect(await screen.findByText('Favorilerim')).toBeInTheDocument();
    expect(screen.queryByText('404')).not.toBeInTheDocument();
  });
});
