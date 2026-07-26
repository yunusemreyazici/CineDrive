import axios, { type AxiosError } from 'axios';
import type { ApiErrorResponse } from '@cinedrive/shared';
import { t } from '../i18n';

const baseURL = import.meta.env.VITE_API_URL || '/api';

export const apiClient = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface FormattedApiError {
  code: string;
  message: string;
  requestId?: string;
  status: number;
}

export function parseApiError(error: unknown): FormattedApiError {
  if (axios.isAxiosError(error)) {
    const axiosErr = error as AxiosError<ApiErrorResponse>;
    const status = axiosErr.response?.status || 500;
    const errorData = axiosErr.response?.data?.error;

    return {
      code: errorData?.code || 'UNKNOWN_ERROR',
      message: errorData?.message || axiosErr.message || t.errors.networkError,
      requestId: errorData?.requestId,
      status,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : t.errors.unexpected,
    status: 500,
  };
}
