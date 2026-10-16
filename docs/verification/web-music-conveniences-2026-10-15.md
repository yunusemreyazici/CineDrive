# Web music conveniences — 2026-10-15

## Behavior

The full music player offers a 15/30/45/60-minute sleep timer. The desktop dock
also provides a compact shortcut. The active control shows the local end time;
opening it again allows replacing or cancelling the timer. Expiry pauses both
local audio slots without clearing the queue, selection or seek position.
The timer belongs to this tab/provider, resets on reload or account change and
is never persisted in shared playback state or sent as a remote-device command.

Track detail, album detail and the full player can copy a music detail link.
These are normal authenticated page URLs; they carry no stream token, playback
client identity or public-access grant. Clipboard denial uses localized feedback.

## Implementation

`useMusicSleepTimer` keeps an absolute deadline rather than decrementing a
counter. Timeout, visibility/focus/pageshow and audio events check that deadline.
This catches expiry when a background tab resumes JavaScript after throttling;
no web timer can execute while the browser/OS has suspended JavaScript entirely.
Cancellation, owner changes and unmount remove callbacks. No second-by-second
context updates or extra API polling are added.

The provider exposes an explicit pause operation that clears pending autoplay,
cancels a crossfade transition and pauses both slots. An intent generation guard
prevents a radio request already in flight from selecting/starting its result
after the timer pauses playback. The usual pause control shares that operation.
An explicit-pause guard also rejects a delayed `ended` event, preventing repeat-one
or a prepared next track from restarting audio after expiry.

`MusicSleepTimerButton` reuses the shared modal. `CopyMusicLinkButton` is reused
by both detail pages and Now Playing. All new copy is in the TR/EN dictionaries.
No server/shared API/schema/dependency or CineMusic change and no migration.

## Verification

- Full web suite: 212 unit tests passed, 37 files.
- Timer and provider coverage includes exact expiry, cancellation/replacement,
  background wake, account isolation, unmount, both-slot pause, late metadata
  and pending-radio completion after expiry, plus repeat-one receiving a queued
  `ended` event after expiry. Clipboard tests cover both route
  kinds, identifier escaping and rejected permissions.
- Web typecheck, repository lint, production build, bundle budget and whitespace
  checks passed. Entry: approximately 354.01 kB raw / 105.12 kB gzip. This is the
  entry chunk measurement, not the total size of every initially loaded chunk.
- Combined Chromium/WebKit run of music conveniences, saved views/search and
  existing smoke flows: 38 passed in 2.5 minutes.

Browser tests use the isolated E2E catalogue and actual local audio/video,
covering 1440 and 390 px. The test clock advances the deadline rather than
waiting 15 minutes. The timer tests keep the short audio fixture playing through
the actual repeat-one control, verify audio is active before expiry, then check
both audio elements are paused and the selection/queue are retained.
Physical-device/OS suspension remains outside that coverage.
No production data or live device playback was changed, and no deploy occurred.

Commands:

```sh
pnpm --filter @cinedrive/web test --maxWorkers=1
pnpm --filter @cinedrive/web typecheck
pnpm lint
pnpm --filter @cinedrive/web build
pnpm bundle:check
pnpm docs:check
git diff --check
pnpm exec playwright test e2e/music-convenience.spec.ts e2e/web-shortcuts.spec.ts e2e/smoke.spec.ts
```
