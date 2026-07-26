import { create } from 'zustand';
import { parseApiError } from '../api/client';
import { t } from '../i18n';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
  /** Optional second line, e.g. a request id or a hint. */
  detail?: string;
  /** Milliseconds before auto-dismiss. `0` keeps it until dismissed. */
  durationMs: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'durationMs'> & { durationMs?: number }) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const DEFAULT_DURATION_MS = 4000;
/** Errors stay longer — they usually carry something the user must read. */
const ERROR_DURATION_MS = 7000;

let toastSequence = 0;
const nextToastId = () => {
  toastSequence += 1;
  return `toast_${toastSequence}`;
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: ({ variant, message, detail, durationMs }) => {
    const id = nextToastId();
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id,
          variant,
          message,
          detail,
          durationMs:
            durationMs ?? (variant === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS),
        },
      ],
    }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * Convenience helpers so call sites do not each re-implement "turn this unknown
 * error into a readable sentence".
 */
export const toast = {
  success: (message: string, detail?: string) =>
    useToastStore.getState().push({ variant: 'success', message, detail }),
  info: (message: string, detail?: string) =>
    useToastStore.getState().push({ variant: 'info', message, detail }),
  error: (message: string, detail?: string) =>
    useToastStore.getState().push({ variant: 'error', message, detail }),
  /** Turns an API/network failure into an error toast. */
  fromError: (error: unknown, fallbackMessage?: string) => {
    const { message, requestId } = parseApiError(error);
    return useToastStore.getState().push({
      variant: 'error',
      message: message || fallbackMessage || t.errors.unexpected,
      detail: requestId ? t.common.requestId(requestId) : undefined,
    });
  },
};
