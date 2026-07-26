import React, { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@cinedrive/shared';
import { Film, Lock, Mail, AlertCircle, Loader2 } from 'lucide-react';
import { useLoginMutation } from '../hooks/useApi';
import { t } from '../i18n';

export const LoginPage: React.FC = () => {
  const fieldId = useId();
  const navigate = useNavigate();
  const loginMutation = useLoginMutation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = (data: LoginInput) => {
    loginMutation.mutate(data, {
      onSuccess: () => navigate('/'),
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 md:p-8">
      {/* Glow background effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md bg-zinc-900/60 border border-zinc-800/80 rounded-3xl p-8 backdrop-blur-xl shadow-2xl">
        {/* App Logo & Title */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand-600/20 border border-brand-500/30 text-brand-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-brand-500/10">
            <Film className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold font-display text-white tracking-tight">CineDrive</h1>
          <p className="text-xs text-zinc-400 mt-1">{t.auth.appTagline}</p>
        </div>

        {/* Global Error Banner */}
        {loginMutation.error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{t.auth.signInFailed}</p>
              <p>{loginMutation.error.message}</p>
            </div>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label
              htmlFor={`${fieldId}-email`}
              className="block text-xs font-semibold text-zinc-300 mb-1.5 font-display"
            >
              {t.auth.email}
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                id={`${fieldId}-email`}
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                {...register('email')}
                placeholder="admin@cinedrive.local"
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-950/60 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
              />
            </div>
            {errors.email && (
              <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label
              htmlFor={`${fieldId}-password`}
              className="block text-xs font-semibold text-zinc-300 mb-1.5 font-display"
            >
              {t.auth.password}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                id={`${fieldId}-password`}
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-zinc-950/60 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all"
              />
            </div>
            {errors.password && (
              <p className="text-xs text-red-400 mt-1">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-brand-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loginMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t.auth.signingIn}
              </>
            ) : (
              t.auth.signIn
            )}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-zinc-800 text-center">
          <p className="text-xs text-zinc-500 leading-relaxed">
            {t.auth.driveHint}{' '}
            <span className="text-zinc-400 font-medium">{t.auth.driveHintSettings}</span>{' '}
            {t.auth.driveHintSuffix}
          </p>
        </div>
      </div>
    </div>
  );
};
