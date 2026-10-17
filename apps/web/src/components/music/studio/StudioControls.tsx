import type { PropsWithChildren, ButtonHTMLAttributes } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../../../api/client';
import { useStudioWrite } from '../../../hooks/useMusicStudio';
import { ErrorState } from '../../common/ErrorState';
import { t } from '../../../i18n';

export const StudioPanel = ({ children }: PropsWithChildren) => (
  <section className="space-y-4 rounded-2xl border border-white/10 bg-zinc-900/40 p-5 md:p-7">
    {children}
  </section>
);
export const StudioButton = (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...props}
    className={`rounded-lg border border-white/15 px-3 py-2 text-sm font-medium hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 disabled:opacity-40 ${props.className ?? ''}`}
  />
);
export const studioInput =
  'rounded-lg border border-white/15 bg-zinc-950 p-2 text-sm text-white focus-visible:outline-brand-400';

/** A retry reuses the exact body + operation ID. Never retry a version conflict automatically. */
// eslint-disable-next-line react-refresh/only-export-components -- hook renders the shared Studio retry controls
export function useStudioAction(owner: string) {
  const mutation = useStudioWrite(owner);
  const pending = useRef<Parameters<typeof mutation.mutateAsync>[0] | null>(null);
  const onSuccess = useRef<(() => void) | undefined>(undefined);
  const createdAt = useRef(0);
  const [uncertain, setUncertain] = useState(false);
  const [expired, setExpired] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const busy = useRef(false);
  const run = async (input: Parameters<typeof mutation.mutateAsync>[0], success?: () => void) => {
    // Do not replace an ambiguous operation with a fresh ID on a second submit.
    if (busy.current || (uncertain && input !== pending.current)) return;
    if (input !== pending.current) {
      onSuccess.current = success;
      createdAt.current = Date.now();
    }
    busy.current = true;
    pending.current = input;
    try {
      await mutation.mutateAsync(input);
      pending.current = null;
      if (active.current) {
        setUncertain(false);
        onSuccess.current?.();
      }
    } catch (error) {
      const hasReceipt =
        !!input.body && typeof input.body === 'object' && 'operationId' in input.body;
      if (active.current)
        setUncertain(
          hasReceipt &&
            (!(error instanceof ApiRequestError) || error.status === 0 || error.status >= 500),
        );
    } finally {
      busy.current = false;
    }
  };
  return {
    run,
    busy: mutation.isPending || uncertain,
    error: mutation.error,
    feedback: mutation.isError ? (
      <div className="space-y-2">
        <ErrorState error={mutation.error} />
        <p className="text-sm text-zinc-400">{t.studio.refreshConflict}</p>
        {uncertain && (
          <>
            <p className="text-sm">{expired ? t.studio.retryExpired : t.studio.retryHint}</p>
            <StudioButton
              disabled={expired}
              onClick={() => {
                if (Date.now() - createdAt.current >= 86400000) setExpired(true);
                else if (pending.current) void run(pending.current);
              }}
            >
              {t.studio.retryWrite}
            </StudioButton>
          </>
        )}
      </div>
    ) : null,
  };
}
