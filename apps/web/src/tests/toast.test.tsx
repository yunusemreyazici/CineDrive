import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
      toast.fromError({
        isAxiosError: true,
        response: {
          status: 404,
          data: { error: { code: 'NOT_FOUND', message: 'Medya bulunamadı.', requestId: 'req_1' } },
        },
      });
    });

    expect(screen.getByText('Medya bulunamadı.')).toBeInTheDocument();
    expect(screen.getByText('İstek No: req_1')).toBeInTheDocument();
  });
});
