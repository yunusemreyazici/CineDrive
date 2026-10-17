# PR 128 browser fixture correction — 2026-10-17

The previous Chromium job failed two queue scenarios and desktop playlist search while waiting for Pause. Its trace contains a successful HTTP 206 audio response, but the returned M4A is only 2,819 bytes. Decoding the artifact with FFmpeg reports a duration of 0.02 seconds despite the fixture database claiming 90 seconds. WebKit's successful run did not establish Linux fixture correctness.

The audio generator used `-shortest` with a single-frame attached cover image. Replace it with an explicit 90-second output duration. Decode the resulting audio at seed time and reject durations outside a one-second tolerance, so a successful FFmpeg exit alone cannot hide truncation. This changes only disposable test media, not production playback.

A local Studio test also exposed a journal-request race: the playlist detail had already shown the removal while the independent history request still displayed the previous addition as its first row. Wait for the removal summary before expanding that revision. No assertion, retry or timeout is weakened.

Workspace verification for the accompanying collaboration update passed: **30 shared, 261 web and 539 server tests**, workspace typecheck, full ESLint, production build and bundle-size check. After correcting the seed, `pnpm exec playwright test e2e/music-studio.spec.ts e2e/music-queue.spec.ts e2e/playlist-search.spec.ts` passed **all 14 tests** across Chromium/WebKit and desktop/mobile (1.2 minutes). The seed's decoded-duration check passed. Changed E2E-file ESLint, documentation links and `git diff --check` also passed. A preliminary browser run overlapped the shared-package build, causing Vite reloads; it is not counted as final evidence.

No real database, account, invitation, AI provider or lyrics provider is used. GitHub's next Linux Chromium run remains the authoritative verification on the affected platform.
