import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { LibraryDto, SourceScanSummaryDto } from '@cinedrive/shared';
import { SetupPage } from '../pages/SetupPage';
import { copy as c } from '../pages/setup/copy';
import { apiClient } from '../api/client';
import { createTestQueryClient, renderWithProviders } from './helpers/renderWithProviders';

const drive: LibraryDto = {
  id: 'drive-1',
  name: 'Google Drive',
  storageType: 'gdrive',
  accessRole: 'owner',
  createdAt: '',
  updatedAt: '',
};
const local: LibraryDto = {
  ...drive,
  id: 'local-1',
  name: 'Films',
  storageType: 'local',
  localFolderPath: '/media/films',
};
let libraries: LibraryDto[];
let scan: {
  id: string;
  status: string;
  addedCount: number;
  updatedCount: number;
  errorCount: number;
  driveScanSourceId?: string;
} | null;
let sources: Array<{
  id: string;
  libraryId: string;
  folderName: string;
  rootFolderId: string;
  lastScan?: SourceScanSummaryDto;
}>;
function renderPage(route = '/setup', role = 'admin') {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(['session'], { authenticated: true, user: { id: 'admin-1', role } });
  return renderWithProviders(<SetupPage />, { route, queryClient });
}
beforeEach(() => {
  libraries = [drive];
  scan = null;
  sources = [];
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    const data =
      url === '/libraries'
        ? { libraries: [...libraries] }
        : url === '/auth/google/connections'
          ? { connections: [{ id: 'connection-1', email: 'owner@example.test' }] }
          : url.endsWith('/drive-sources')
            ? { sources: [...sources] }
            : url.endsWith('/scans')
              ? { scans: scan ? [scan] : [] }
              : {};
    return { data } as never;
  });
  vi.spyOn(apiClient, 'post').mockImplementation(async (url, data) => {
    if (url === '/libraries/validate-local')
      return { data: { validation: { readable: true } } } as never;
    if (url.endsWith('/validate'))
      return {
        data: {
          validation: {
            folderName:
              (data as { rootFolderId?: string } | undefined)?.rootFolderId === ''
                ? c.entireDrive
                : 'Drive films',
          },
        },
      } as never;
    if (url === '/libraries') {
      libraries.push(local);
      return { data: { library: local } } as never;
    }
    if (url.endsWith('/drive-sources')) {
      const source = {
        id: 'source-1',
        libraryId: drive.id,
        rootFolderId: 'folder-1',
        folderName: 'Drive films',
      };
      sources.push(source);
      return { data: { source } } as never;
    }
    if (url.endsWith('/scan')) throw new Error('scan unavailable');
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function localDetails() {
  fireEvent.click(await screen.findByRole('button', { name: c.next }));
  fireEvent.change(screen.getByLabelText(c.name), { target: { value: 'Films' } });
  fireEvent.change(screen.getByLabelText(c.path), { target: { value: '/media/films' } });
}
describe('optional first-library setup', () => {
  it('checks access before creation, separates scanning, and never recreates on scan retry', async () => {
    renderPage();
    await localDetails();
    fireEvent.click(screen.getByRole('button', { name: c.verify }));
    await screen.findByText(c.verified);
    expect(apiClient.post).not.toHaveBeenCalledWith('/libraries', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: c.create }));
    await screen.findByRole('button', { name: c.start });
    expect(apiClient.post).not.toHaveBeenCalledWith('/libraries/local-1/scan', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: c.start }));
    await screen.findByText(c.scanError);
    await waitFor(() => expect(screen.getByRole('button', { name: c.start })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: c.start }));
    await waitFor(() =>
      expect(
        vi.mocked(apiClient.post).mock.calls.filter(([url]) => url.endsWith('/scan')),
      ).toHaveLength(2),
    );
    expect(
      vi.mocked(apiClient.post).mock.calls.filter(([url]) => url === '/libraries'),
    ).toHaveLength(1);
  });
  it('does not advance or create anything after failed validation', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('sensitive implementation detail'));
    renderPage();
    await localDetails();
    fireEvent.click(screen.getByRole('button', { name: c.verify }));
    await screen.findByText(c.accessError);
    expect(screen.queryByRole('button', { name: c.create })).not.toBeInTheDocument();
    expect(screen.queryByText('sensitive implementation detail')).not.toBeInTheDocument();
  });
  it('back navigation does not submit the access-check form', async () => {
    renderPage();
    await localDetails();
    fireEvent.click(screen.getByRole('button', { name: c.back }));
    expect(screen.getByRole('radio', { name: new RegExp(c.local) })).toBeChecked();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('validates and saves only the selected Drive folder/account', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(c.drive) }));
    fireEvent.click(screen.getByRole('button', { name: c.next }));
    await screen.findByText('owner@example.test');
    expect(screen.getByRole('radio', { name: new RegExp(c.specificFolder) })).toBeChecked();
    fireEvent.change(screen.getByLabelText(c.account), { target: { value: 'connection-1' } });
    fireEvent.change(screen.getByLabelText(c.folder), { target: { value: 'folder-1' } });
    fireEvent.click(screen.getByRole('button', { name: c.verify }));
    await screen.findByText(c.verified);
    expect(apiClient.post).toHaveBeenCalledWith('/libraries/drive-1/drive-sources/validate', {
      googleConnectionId: 'connection-1',
      rootFolderId: 'folder-1',
    });
    fireEvent.click(screen.getByRole('button', { name: c.create }));
    await screen.findByRole('button', { name: c.start });
    expect(apiClient.post).toHaveBeenCalledWith('/libraries/drive-1/drive-sources', {
      googleConnectionId: 'connection-1',
      rootFolderId: 'folder-1',
    });
    expect(apiClient.post).not.toHaveBeenCalledWith('/libraries', expect.anything());
  });
  it('validates and saves the whole Drive account without requiring a folder ID', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: new RegExp(c.drive) }));
    fireEvent.click(screen.getByRole('button', { name: c.next }));
    await screen.findByText('owner@example.test');
    fireEvent.change(screen.getByLabelText(c.account), { target: { value: 'connection-1' } });
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(c.entireDrive) }));
    expect(screen.queryByLabelText(c.folder)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: c.verify })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: c.verify }));
    await screen.findByText(c.verified);
    expect(apiClient.post).toHaveBeenCalledWith('/libraries/drive-1/drive-sources/validate', {
      googleConnectionId: 'connection-1',
      rootFolderId: '',
    });
    expect(screen.getAllByText(c.entireDrive).length).toBeGreaterThan(0);
    expect(screen.getByText(c.entireDriveReview)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.create }));
    await screen.findByRole('button', { name: c.start });
    expect(apiClient.post).toHaveBeenCalledWith('/libraries/drive-1/drive-sources', {
      googleConnectionId: 'connection-1',
      rootFolderId: '',
    });
  });
  it('resumes an empty completed scan from its saved URL without creating or scanning again', async () => {
    libraries.push(local);
    scan = { id: 'scan-1', status: 'completed', addedCount: 0, updatedCount: 0, errorCount: 0 };
    renderPage('/setup?library=local-1');
    await screen.findByText(c.completed);
    expect(screen.getByText(c.empty)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('does not allow an inaccessible library or a non-admin to start setup', async () => {
    const first = renderPage('/setup?library=other-user-library');
    await screen.findByText(c.missing);
    expect(screen.queryByRole('button', { name: c.start })).not.toBeInTheDocument();
    first.unmount();
    vi.mocked(apiClient.get).mockClear();
    renderPage('/setup', 'user');
    expect(screen.getByText(c.admin)).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });
  it('polls a running scan until complete and prevents another start while running', async () => {
    libraries.push(local);
    scan = { id: 'scan-1', status: 'running', addedCount: 0, updatedCount: 0, errorCount: 0 };
    renderPage('/setup?library=local-1');
    await screen.findByText(c.running);
    expect(screen.getByRole('button', { name: c.retry })).toBeDisabled();
    scan = { ...scan, status: 'completed', updatedCount: 2 };
    await screen.findByText(c.completed, {}, { timeout: 4000 });
    expect(screen.getByRole('button', { name: c.retry })).toBeEnabled();
    expect(screen.queryByText(c.empty)).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('ignores another Drive source’s scan when resuming a saved folder', async () => {
    sources = [
      { id: 'source-1', libraryId: drive.id, folderName: 'Films', rootFolderId: 'folder-1' },
    ];
    scan = {
      id: 'scan-1',
      status: 'completed',
      addedCount: 5,
      updatedCount: 0,
      errorCount: 0,
      driveScanSourceId: 'other-source',
    };
    renderPage('/setup?library=drive-1&source=source-1');
    await screen.findByText(c.waiting);
    expect(screen.queryByText(c.completed)).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('uses a saved source summary when its scan has aged out of library history', async () => {
    sources = [
      {
        id: 'source-1',
        libraryId: drive.id,
        folderName: 'Films',
        rootFolderId: 'folder-1',
        lastScan: {
          status: 'completed',
          startedAt: '',
          addedCount: 5,
          updatedCount: 0,
          deletedCount: 0,
          errorCount: 0,
        },
      },
    ];
    renderPage('/setup?library=drive-1&source=source-1');
    await screen.findByText(c.completed);
    expect(screen.getByText(c.counts(5, 0, 0))).toBeInTheDocument();
    expect(screen.queryByText(c.waiting)).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('requires another access check after editing a verified folder', async () => {
    renderPage();
    await localDetails();
    fireEvent.click(screen.getByRole('button', { name: c.verify }));
    await screen.findByText(c.verified);
    fireEvent.click(screen.getByRole('button', { name: c.back }));
    fireEvent.change(screen.getByLabelText(c.path), { target: { value: '/media/other' } });
    expect(screen.queryByRole('button', { name: c.create })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.verify }));
    await screen.findByText(c.verified);
    expect(apiClient.post).toHaveBeenLastCalledWith('/libraries/validate-local', {
      localFolderPath: '/media/other',
    });
  });
});
