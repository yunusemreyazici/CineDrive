import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCatalogueLayout, catalogueLayoutKey } from '../hooks/useCatalogueLayout';
import { CatalogueLayoutControls } from '../components/media/CatalogueLayoutControls';
import { createTestQueryClient, seedSession } from './helpers/renderWithProviders';
import { t } from '../i18n';

function Probe() {
  const layout = useCatalogueLayout();
  return (
    <>
      <CatalogueLayoutControls layout={layout} />
      <output>
        {layout.mode}:{layout.size}
      </output>
    </>
  );
}
function mount() {
  const client = createTestQueryClient();
  seedSession(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  };
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('remembers size and mode on remount without losing the selected poster size', () => {
  const first = mount();
  fireEvent.change(screen.getByLabelText(t.catalogueLayout.posterSize), {
    target: { value: 'large' },
  });
  fireEvent.click(screen.getByRole('button', { name: t.library.listView }));
  expect(screen.getByLabelText(t.catalogueLayout.posterSize)).toBeDisabled();
  first.unmount();
  mount();
  expect(screen.getByText('list:large')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: t.library.gridView }));
  expect(screen.getByText('grid:large')).toBeInTheDocument();
});

it('does not leak preferences on account changes or logout', async () => {
  const { client } = mount();
  fireEvent.click(screen.getByRole('button', { name: t.library.listView }));
  await act(async () => {
    client.setQueryData(['session'], { authenticated: true, user: { id: 'other' } });
  });
  await waitFor(() => expect(screen.getByText('grid:medium')).toBeInTheDocument());
  await act(async () => {
    seedSession(client);
  });
  await waitFor(() => expect(screen.getByText('list:medium')).toBeInTheDocument());
  await act(async () => {
    client.setQueryData(['session'], { authenticated: false });
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t.library.listView })).toBeDisabled(),
  );
  expect(screen.getByText('grid:medium')).toBeInTheDocument();
});

it.each(['broken', 'null', '{"mode":"unsafe","size":"2000px"}', 'x'.repeat(300)])(
  'rejects invalid stored values: %s',
  (raw) => {
    localStorage.setItem(catalogueLayoutKey('user-1'), raw);
    mount();
    expect(screen.getByText('grid:medium')).toBeInTheDocument();
  },
);

it('keeps the control usable and reports persistence failure', () => {
  mount();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  fireEvent.click(screen.getByRole('button', { name: t.library.listView }));
  expect(screen.getByText('list:medium')).toBeInTheDocument();
  expect(screen.getByText(t.catalogueLayout.notSaved)).toHaveAttribute('role', 'status');
});

it('reacts to same-account cross-tab updates and storage clearing', () => {
  mount();
  const key = catalogueLayoutKey('user-1');
  localStorage.setItem(key, JSON.stringify({ mode: 'list', size: 'small' }));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
  expect(screen.getByText('list:small')).toBeInTheDocument();
  localStorage.clear();
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
  expect(screen.getByText('grid:medium')).toBeInTheDocument();
});
