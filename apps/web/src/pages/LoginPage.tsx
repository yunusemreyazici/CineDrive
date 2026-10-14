import React, { useId, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  const location = useLocation();
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
      onSuccess: () => {
        const requestedPath = (location.state as { returnTo?: unknown } | null)?.returnTo;
        const returnTo =
          typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//')
            ? requestedPath
            : '/';
        navigate(returnTo, { replace: true });
      },
    });
  };

  return (
    <div className="cd-auth">
      <aside className="cd-auth-story">
        <div className="flex items-center gap-3 font-display text-xl font-semibold"><Film className="h-8 w-8 text-brand-400" />CineDrive</div>
        <div>
          <h2 className="font-display">{t.design.authTitle}</h2>
          <p className="relative mt-6 max-w-sm text-sm leading-7 text-zinc-300">{t.design.authDescription}</p>
        </div>
        <footer className="cd-eyebrow">{t.design.privateLibrary}</footer>
      </aside>
      <div className="cd-auth-form">
        {/* App Logo & Title */}
        <div className="mb-9">
          <p className="cd-eyebrow mb-3">{t.auth.signIn}</p>
          <h1 className="text-3xl font-medium font-display text-white tracking-tight">{t.design.signInTitle}</h1>
          <p className="text-sm text-zinc-400 mt-3">{t.design.signInDescription}</p>
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
            className="cd-primary w-full mt-3"
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
