import React from 'react';
import { Film } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.FC<{ className?: string }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon = Film,
  title,
  description,
  actionLabel,
  onAction,
}) => {
  return (
    <div className="cd-feedback flex flex-col items-center justify-center text-center">
      <div className="p-4 rounded-2xl bg-zinc-800/40 text-zinc-400 mb-4 border border-zinc-700/30">
        <Icon className="w-10 h-10" />
      </div>
      <h3 className="text-xl font-semibold text-zinc-100 mb-2 font-display">{title}</h3>
      <p className="text-sm text-zinc-400 max-w-sm mb-6 leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-xl transition-all shadow-md shadow-brand-500/20"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
