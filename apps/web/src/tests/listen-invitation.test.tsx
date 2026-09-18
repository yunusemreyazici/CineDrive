import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../routes/AppRoutes';
import aasa from '../../public/.well-known/apple-app-site-association?raw';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function open(code: string) {
  return render(
    <MemoryRouter initialEntries={[`/music/listen/${code}`]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}
describe('Public listening invitation', () => {
  it('opens without authentication and only joins through the app', async () => {
    open('1234567890abcdef');
    expect(await screen.findByTestId('invitation-code')).toHaveTextContent('1234567890ABCDEF');
    const link = screen.getByRole('link');
    const target = new URL(link.getAttribute('href')!);
    expect(target.protocol).toBe('cinemusic:');
    expect(target.hostname).toBe('listen');
    expect(target.searchParams.get('url')).toBe(
      `${window.location.origin}/music/listen/1234567890ABCDEF`,
    );
  });
  it('copies the code and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open('1234567890ABCDEF');
    const button = await screen.findByRole('button', { name: 'Kodu kopyala' });
    fireEvent.click(button);
    expect(await screen.findByText('Kopyalandı')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('1234567890ABCDEF');
  });
  it('rejects malformed invitations without an app link', async () => {
    open('bad-code');
    expect(await screen.findByText('Bu davet bağlantısı geçersiz.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('associates the invitation path with CineMusic', () => {
    expect(JSON.parse(aasa).applinks.details[0].components).toContainEqual(
      expect.objectContaining({ '/': '/music/listen/*' }),
    );
  });
});
