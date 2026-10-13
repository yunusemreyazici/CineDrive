import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from '../pages/LoginPage';
import { ProtectedRoute } from '../routes/ProtectedRoute';
import { ApiRequestError, apiClient } from '../api/client';

const user = { id: 'qa-user', email: 'qa@example.com', name: 'QA', role: 'user', isActive: true };
const anonymous = { authenticated: false, user: null, authMode: 'multi-user' };
const authenticated = { ...anonymous, authenticated: true, user };

function Destination() {
  const location = useLocation();
  return <h1>{`Destination: ${location.pathname}${location.search}${location.hash}`}</h1>;
}

function renderLogin({ cached = true, returnTo }: { cached?: boolean; returnTo?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) queryClient.setQueryData(['session'], anonymous);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { returnTo } }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="*" element={<Destination />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

function submitLogin() {
  fireEvent.change(screen.getByPlaceholderText('admin@cinedrive.local'), {
    target: { value: user.email },
  });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: /giriş yap/i }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LoginPage Component', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  it('renders login form elements and branding', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText('CineDrive')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('admin@cinedrive.local')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /giriş yap/i })).toBeInTheDocument();
  });

  it('waits for a fresh session before returning to the requested route with a cached anonymous session', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user } } as never);
    let resolveSession: (() => void) | undefined;
    const get = vi.spyOn(apiClient, 'get').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSession = () => resolve({ data: authenticated } as never);
        }),
    );
    const client = renderLogin({ returnTo: '/music?tab=albums#recent' });
    submitLogin();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /giriş yapılıyor/i })).toBeDisabled();
    expect(screen.queryByText(/^Destination:/)).not.toBeInTheDocument();
    // Duplicate submission cannot create a second session while verification is pending.
    fireEvent.click(screen.getByRole('button', { name: /giriş yapılıyor/i }));
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSession?.();
    });
    expect(await screen.findByText('Destination: /music?tab=albums#recent')).toBeInTheDocument();
    expect(client.getQueryData(['session'])).toEqual(authenticated);
    expect(get).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it.each([undefined, '//outside.example', 'https://outside.example'])(
    'uses the home route for returnTo=%s on a direct login',
    async (returnTo) => {
      vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user } } as never);
      vi.spyOn(apiClient, 'get').mockResolvedValue({ data: authenticated } as never);
      const client = renderLogin({ cached: false, returnTo });
      submitLogin();
      expect(await screen.findByText('Destination: /')).toBeInTheDocument();
      client.clear();
    },
  );

  it('shows invalid credentials without verifying or navigating', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      new ApiRequestError(401, null, 'Invalid credentials'),
    );
    const get = vi.spyOn(apiClient, 'get');
    const client = renderLogin();
    submitLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(get).not.toHaveBeenCalled();
    expect(client.getQueryData(['session'])).toEqual(anonymous);
    client.clear();
  });

  it('shows a session verification failure and permits retry without navigating', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user } } as never);
    vi.spyOn(apiClient, 'get')
      .mockRejectedValueOnce(new ApiRequestError(503, null, 'Session unavailable'))
      .mockResolvedValue({ data: authenticated } as never);
    const client = renderLogin();
    submitLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Session unavailable');
    expect(screen.getByRole('button', { name: /giriş yap/i })).toBeEnabled();
    submitLogin();
    expect(await screen.findByText('Destination: /')).toBeInTheDocument();
    client.clear();
  });

  it('does not navigate when the login cookie did not establish a session', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user } } as never);
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: anonymous } as never);
    const client = renderLogin();
    submitLogin();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/^Destination:/)).not.toBeInTheDocument();
    expect(client.getQueryData(['session'])).toEqual(anonymous);
    client.clear();
  });
});
