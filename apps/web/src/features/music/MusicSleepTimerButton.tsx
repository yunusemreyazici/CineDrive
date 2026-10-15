import { useState } from 'react';
import { Moon } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useMusicPlayer } from './MusicPlayerProvider';
import { intlLocale, t } from '../../i18n';
import type { SleepTimerMinutes } from './useMusicSleepTimer';

export function MusicSleepTimerButton({ compact = false }: { compact?: boolean }) {
  const player = useMusicPlayer();
  const [open, setOpen] = useState(false);
  const active = player.sleepTimerEndsAt !== null;
  const endsAt = active
    ? new Date(player.sleepTimerEndsAt!).toLocaleTimeString(intlLocale, {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  const label = active ? t.music.sleepTimerUntil(endsAt) : t.music.sleepTimer;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={
          compact
            ? `hidden rounded-lg p-2 md:inline-flex ${active ? 'text-brand-300' : 'text-zinc-400 hover:text-white'}`
            : 'cd-pill-link'
        }
      >
        <Moon className="h-4 w-4" />
        {!compact && label}
      </button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t.music.sleepTimer}
        description={t.music.sleepTimerHint}
        size="sm"
      >
        <div className="space-y-4 p-6">
          {active && (
            <p role="status" className="text-sm text-brand-300">
              {t.music.sleepTimerUntil(endsAt)}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {([15, 30, 45, 60] satisfies SleepTimerMinutes[]).map((minutes) => (
              <button
                key={minutes}
                type="button"
                className="cd-pill-link"
                onClick={() => {
                  player.setSleepTimer(minutes);
                  setOpen(false);
                }}
              >
                {t.common.minutes(minutes)}
              </button>
            ))}
          </div>
          {active && (
            <button
              type="button"
              className="cd-pill-link w-full"
              onClick={() => {
                player.setSleepTimer(null);
                setOpen(false);
              }}
            >
              {t.music.cancelSleepTimer}
            </button>
          )}
          <p className="text-xs leading-5 text-zinc-500">{t.music.sleepTimerSessionHint}</p>
        </div>
      </Modal>
    </>
  );
}
