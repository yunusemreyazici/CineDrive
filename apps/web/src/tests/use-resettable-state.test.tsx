import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useResettableState } from '../hooks/useResettableState';

describe('useResettableState', () => {
  it('preserves local edits until the reset key changes', () => {
    const { result, rerender } = renderHook(
      ({ resetKey, resetValue }) => useResettableState(resetValue, resetKey),
      { initialProps: { resetKey: 'episode-1', resetValue: 'default-1' } },
    );

    act(() => result.current[1]('edited'));
    rerender({ resetKey: 'episode-1', resetValue: 'default-2' });
    expect(result.current[0]).toBe('edited');

    rerender({ resetKey: 'episode-2', resetValue: 'default-2' });
    expect(result.current[0]).toBe('default-2');
  });
});
