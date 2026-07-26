import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Editable local state that re-seeds itself whenever the server value behind it
 * changes — the "adjusting state when a prop changes" pattern from the React
 * docs, applied during render instead of in an effect.
 *
 * Doing it in an effect (the previous approach across the settings forms) meant
 * an extra render with stale field values on every refetch, and tripped the
 * `react-hooks/set-state-in-effect` rule.
 */
export function useSyncedState<T>(externalValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(externalValue);
  const [lastExternalValue, setLastExternalValue] = useState<T>(externalValue);

  if (externalValue !== lastExternalValue) {
    setLastExternalValue(externalValue);
    setValue(externalValue);
  }

  return [value, setValue];
}
