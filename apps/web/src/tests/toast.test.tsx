import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ApiRequestError, parseApiError } from '../api/client';
import { ToastViewport } from '../components/common/ToastViewport';
import { toast, useToastStore } from '../stores/useToastStore';

describe('Toast system', () => {
  beforeEach(() => {
    useToastStore.getState().clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing until something is pushed', () => {
    render(<ToastViewport />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('announces messages politely', () => {
    render(<ToastViewport />);
    act(() => {
      toast.success('Kaydedildi');
    });

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Kaydedildi')).toBeInTheDocument();
  });

  it('auto-dismisses after its duration', () => {
    render(<ToastViewport />);
    act(() => {
      toast.info('Geçici mesaj');
    });
    expect(screen.getByText('Geçici mesaj')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText('Geçici mesaj')).not.toBeInTheDocument();
  });

  it('keeps errors on screen longer than confirmations', () => {
    render(<ToastViewport />);
    act(() => {
      toast.error('Bir şeyler ters gitti');
    });

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText('Bir şeyler ters gitti')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('Bir şeyler ters gitti')).not.toBeInTheDocument();
  });

  it('turns an API error into a readable message with its request id', () => {
    render(<ToastViewport />);
    act(() => {
      toast.fromError(
        new ApiRequestError(
          404,
          { error: { code: 'NOT_FOUND', message: 'Medya bulunamadı.', requestId: 'req_1' } },
          'Medya bulunamadı.',
        ),
      );
    });

    expect(screen.getByText('Medya bulunamadı.')).toBeInTheDocument();
    expect(screen.getByText('İstek No: req_1')).toBeInTheDocument();
  });

  it('preserves an already-normalized scan conflict instead of showing an unknown error', () => {
    const error = new ApiRequestError(
      409,
      {
        error: {
          code: 'SCAN_ALREADY_IN_PROGRESS',
          message: 'Bu kütüphane için eşzamanlı bir tarama zaten devam ediyor.',
          requestId: 'scan-conflict',
        },
      },
      'Conflict',
    );
    const parsed = parseApiError(error);
    expect(parseApiError(parsed)).toEqual(parsed);
    render(<ToastViewport />);
    act(() => {
      toast.fromError(parsed, 'Tarama başlatılamadı.');
    });
    expect(screen.getByText(parsed.message)).toBeInTheDocument();
    expect(screen.getByText('İstek No: scan-conflict')).toBeInTheDocument();
  });

  it.each([0, 401, 403, 500, 503])(
    'keeps normalized status %s and optional request ID',
    (status) => {
      const error = { code: 'FAILURE', message: 'Readable failure', status };
      expect(parseApiError(error)).toEqual(error);
    },
  );

  it.each([
    { code: '', message: 'x', status: 409 },
    { code: 'FAILURE', message: '', status: 409 },
    { code: 'FAILURE', message: 'x', status: '409' },
    { code: 'FAILURE', message: 'x', status: NaN },
    { code: 'FAILURE', message: 'x', status: 999 },
    { code: 'FAILURE', message: 'x', status: 409, requestId: 1 },
    null,
  ])('rejects malformed normalized error shapes', (input) => {
    expect(parseApiError(input)).toMatchObject({ code: 'UNKNOWN_ERROR', status: 500 });
  });
});
