import React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  queryClient?: QueryClient;
}

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

/**
 * Renders a component with the same providers the app mounts, so page-level
 * tests exercise routing and data fetching the way production does.
 */
export const renderWithProviders = (
  ui: React.ReactElement,
  { route = '/', queryClient = createTestQueryClient(), ...options }: RenderWithProvidersOptions = {},
) => ({
  queryClient,
  ...render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
    options,
  ),
});

/** Seeds an authenticated session so ProtectedRoute lets the tree render. */
export const seedSession = (queryClient: QueryClient) =>
  queryClient.setQueryData(['session'], {
    authenticated: true,
    user: { id: 'user-1', email: 'test@cinedrive.local', name: 'Test' },
  });
