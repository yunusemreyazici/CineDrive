import { describe, expect, it, vi } from 'vitest';
import { collectMusicSearchIds } from '../src/services/music-search.service';

describe('bounded tiered music search', () => {
  it('queries better matches before lower tiers and stops at the existing limit', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'exact' }])
      .mockResolvedValueOnce([{ id: 'prefix' }])
      .mockResolvedValueOnce([{ id: 'contains' }]);
    expect(await collectMusicSearchIds(['exact', 'prefix', 'contains', 'album'], 3, load)).toEqual([
      'exact',
      'prefix',
      'contains',
    ]);
    expect(load.mock.calls).toEqual([
      ['exact', 3, []],
      ['prefix', 2, ['exact']],
      ['contains', 1, ['exact', 'prefix']],
    ]);
  });
  it('deduplicates identities and bounds an empty or partially filled search', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'a' }])
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    expect(await collectMusicSearchIds([0, 1], 8, load)).toEqual(['a', 'b']);
    const empty = vi.fn().mockResolvedValue([]);
    expect(await collectMusicSearchIds([0, 1, 2], 8, empty)).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(3);
  });
});
