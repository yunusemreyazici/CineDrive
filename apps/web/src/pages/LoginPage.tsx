import React, { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@cinedrive/shared';
import { Film, Lock, Mail, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useLoginMutation } from '../hooks/useApi';
import { parseApiError } from '../api/client';
import { t } from '../i18n';

const FIELD_CLASSES =
  'w-full rounded-xl border border-zinc-800 bg-zinc-950/60 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';

export const LoginPage: React.FC = () => {
  const fieldId = useId();
  const navigate = useNavigate();
  const loginMutation = useLoginMutation();
  const [showPassword, setShowPassword] = useState(false);

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

        {/*
          `role="alert"` because this is the only feedback a rejected sign-in
          gives: without it the banner appeared silently and a screen reader
          user was left waiting on a form that looked unchanged.
        */}
        {loginMutation.error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-400"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-semibold">{t.auth.signInFailed}</p>
              <p>{parseApiError(loginMutation.error).message}</p>
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
              <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id={`${fieldId}-email`}
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                // Without this the validation text sits beside the field but is
                // never announced when focus is inside it.
                aria-describedby={errors.email ? `${fieldId}-email-error` : undefined}
                {...register('email')}
                placeholder="admin@cinedrive.local"
                className={FIELD_CLASSES}
              />
            </div>
            {errors.email && (
              <p id={`${fieldId}-email-error`} className="mt-1 text-xs text-red-400">
                {errors.email.message}
              </p>
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
              <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                id={`${fieldId}-password`}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? `${fieldId}-password-error` : undefined}
                {...register('password')}
                placeholder="••••••••"
                className={`${FIELD_CLASSES} pr-11`}
              />
              {/* A typo in a masked field is otherwise only discoverable by
                  failing the sign-in. */}
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                aria-pressed={showPassword}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && (
              <p id={`${fieldId}-password-error`} className="mt-1 text-xs text-red-400">
                {errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:opacity-50"
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
