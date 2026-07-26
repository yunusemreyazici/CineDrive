import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useSessionQuery } from '../hooks/useApi';
import { t } from '../i18n';

export const ProtectedRoute: React.FC = () => {
  const { data: session, isLoading } = useSessionQuery();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
        <span className="text-xs font-semibold font-display tracking-wide">{t.auth.verifyingSession}</span>
      </div>
    );
  }

  if (!session?.authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};
