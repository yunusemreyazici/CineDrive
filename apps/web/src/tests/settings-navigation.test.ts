import { describe, expect, it } from 'vitest';
import { resolvePane, SETTINGS_GROUPS } from '../pages/settings/settingsNavigation';

describe('settings navigation', () => {
  it('keeps About and API management on dedicated panes', () => {
    expect(resolvePane('about')).toBe('about');
    expect(resolvePane('api')).toBe('api');
    expect(resolvePane('openSubtitles')).toBe('api');
    expect(SETTINGS_GROUPS.flatMap((group) => group.panes).map((pane) => pane.id)).toEqual(
      expect.arrayContaining(['appearance', 'about', 'libraries', 'api']),
    );
  });
});
