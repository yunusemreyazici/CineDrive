import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '../../i18n';

interface MediaPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export const MediaPagination: React.FC<MediaPaginationProps> = ({
  page,
  totalPages,
  onPageChange,
}) => {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={t.library.paginationLabel}
      className="flex items-center justify-center gap-4 pt-8"
    >
      <button
        type="button"
        aria-label={t.library.previousPage}
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-300 transition-colors hover:text-white disabled:opacity-40"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="text-sm font-medium text-zinc-400 font-display">
        {t.library.page} <span className="font-bold text-white">{page}</span> / {totalPages}
      </span>
      <button
        type="button"
        aria-label={t.library.nextPage}
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-300 transition-colors hover:text-white disabled:opacity-40"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </nav>
  );
};
