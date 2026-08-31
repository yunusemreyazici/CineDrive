import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Local state that returns to a caller-provided value when its owning entity
 * changes. React applies the reset during render, so descendants never observe
 * one frame of state belonging to the previous media item or subtitle owner.
 */
export function useResettableState<T>(
  resetValue: T,
  resetKey: string | number | null | undefined,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(resetValue);
  const [lastResetKey, setLastResetKey] = useState(resetKey);

  if (!Object.is(resetKey, lastResetKey)) {
    setLastResetKey(resetKey);
    setValue(resetValue);
  }

  return [value, setValue];
}
