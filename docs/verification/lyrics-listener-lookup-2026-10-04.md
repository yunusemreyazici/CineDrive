# Listener automatic lyrics lookup — 2026-10-04

User approved automatic LRCLIB lookup/cache filling for shared-library listeners.
The confirmed production symptom was an accessible track with no cached lyrics:
GET succeeded with `lyrics: null`, while POST lookup returned track-not-found.

## Task list

- [x] Reuse the same active-track ownership/membership scope as lyrics GET for
  POST `/api/music/tracks/:id/lyrics/lookup`.
- [x] Leave manual lyrics, translations, revisions, deletion and sidecar-writing
  authorization unchanged (owner/editor only).
- [x] Reuse provider cache, global serialized request queue and bounded retry
  service unchanged. No lyrics body, provider key or session data logged.
- [x] Add role-matrix regression tests (owner, editor, listener, unrelated,
  unauthenticated), cached lookup, arbitrary-body non-editing, membership
  revocation and inactive/missing-track protection. All external fetches mocked.
- [x] Run tests, typecheck, lint and build.

## Verification

- `MUSIC_AI_API_KEY='' pnpm --filter @cinedrive/server exec vitest run`: 51 test
  files / 397 tests passed. Includes the six new lyrics access regression cases,
  prior lyrics retry/language detection and AI cooldown regressions.
- `pnpm typecheck`: shared, server and web passed.
- `pnpm lint`: passed.
- `pnpm build`: shared, server and web passed; web entry bundle budget passed.
- `git diff --check`: passed.

An initial focused run failed only because the new response assertion expected
internal `sourceType` in the public DTO. The assertion now uses the existing
public `sourceName`, while checking `sourceType` directly in the test database.
No public field was added or permission assertion removed to make it pass.

No migration or CineMusic client change is required; existing lookup envelopes
and status values are preserved. This is a local code change, not a production
deployment. Production lookup still depends on LRCLIB actually having the track.
