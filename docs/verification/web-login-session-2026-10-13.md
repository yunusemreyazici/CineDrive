# Web login session handoff — 2026-10-13

## Reproduction and cause

Live QA reproduced a successful `POST /api/auth/login` (HTTP 200) remaining on
`/login` after navigation from an anonymous protected route. Loading `/music`
as a new document then worked with the same session. No credentials or cookie
values were recorded.

The login mutation invalidated, but did not replace or await, the cached
anonymous session. ProtectedRoute immediately redirected back to login using
that cached result. Unmounting the session observer also cancelled its refresh.
Direct login with an empty query cache did not reproduce the issue.

## Fix

After a successful login response, cancel pre-login session reads and fetch a
fresh `/auth/session` through shared query options with `staleTime: 0`. Complete
the mutation (and run LoginPage's existing returnTo navigation) only after the
server confirms the same account. Session verification uses the existing
cookie, cancellation signal, timeout and no-retry behavior. It does not infer
authentication from submitted credentials or bypass backend authorization.

The submit button stays pending during verification. Missing or mismatched
sessions show localized feedback; network/API errors retain structured error
details. Failed verification does not navigate and can be retried.

No API, cookie policy, database migration or CineMusic changes. Existing lyrics
startup work was preserved and packaged separately on the same review branch.
No live deployment was performed by this task.

## Verification

- Before the fix, the new page tests failed for delayed session verification,
  unavailable session service and missing cookie (3 failed, 5 passed).
- Focused page/hook tests: 16 passed.
- Full web suite: 164 tests passed across 34 files.
- `pnpm typecheck`: passed after the build regenerated shared declarations.
  The first concurrent build/typecheck run raced on generated declaration files;
  the post-build run passed without source changes.
- `pnpm lint`: passed with zero warnings.
- `pnpm build`: passed, including server/shared builds and web bundle budget.
- `git diff --check`: passed.

Regression coverage includes cached anonymous state, delayed verification,
duplicate-button submission, internal returnTo with query/hash, external-path
fallback, invalid credentials, failed verification and retry, absent cookie,
different-account response, and cancellation of a late pre-login response.

Post-deployment check: open a protected address without a session, sign in,
confirm return to that address without reloading, then repeat with direct login.
The live deployment still contains the old code until these changes are deployed.
