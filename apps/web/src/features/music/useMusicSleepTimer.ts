import { useCallback, useEffect, useRef, useState } from 'react';

export type SleepTimerMinutes = 15 | 30 | 45 | 60;
interface Timer {
  owner: string;
  endsAt: number;
}

/** Wall-clock deadline, local to this provider. Visibility/timeupdate checks
 * also catch expiry when a background tab's timeout has been throttled. */
export function useMusicSleepTimer(owner: string | null, onExpire: () => void) {
  const [timer, setTimer] = useState<Timer | null>(null);
  const timerRef = useRef<Timer | null>(null);
  const [lastOwner, setLastOwner] = useState(owner);
  if (lastOwner !== owner) {
    setLastOwner(owner);
    setTimer(null);
  }
  const endsAt = timer?.owner === owner ? (timer?.endsAt ?? null) : null;

  const setSleepTimer = useCallback(
    (minutes: SleepTimerMinutes | null) => {
      if (minutes !== null && (!owner || ![15, 30, 45, 60].includes(minutes))) return;
      const next =
        minutes === null || !owner ? null : { owner, endsAt: Date.now() + minutes * 60_000 };
      timerRef.current = next;
      setTimer(next);
    },
    [owner],
  );

  const checkExpiry = useCallback(() => {
    const active = timerRef.current;
    if (!active || active.owner !== owner || Date.now() < active.endsAt) return false;
    timerRef.current = null;
    setTimer(null);
    onExpire();
    return true;
  }, [owner, onExpire]);

  useEffect(
    () => () => {
      timerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!endsAt) {
      timerRef.current = null;
      return;
    }
    let timeout: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timeout);
      if (!checkExpiry() && timerRef.current?.endsAt === endsAt && timerRef.current.owner === owner)
        timeout = setTimeout(check, Math.max(1, endsAt - Date.now()));
    };
    timeout = setTimeout(check, Math.max(1, endsAt - Date.now()));
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('focus', check);
    };
  }, [endsAt, owner, checkExpiry]);

  return { endsAt, setSleepTimer, checkExpiry };
}
