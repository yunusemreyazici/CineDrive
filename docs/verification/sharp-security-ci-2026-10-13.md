# PR #112 security gate — 2026-10-13

## Cause

At head `567c60a`, CI application verification, Node 22/24 compatibility,
Docker smoke, Chromium/WebKit E2E, CodeQL and release dry-runs passed.
The production dependency audit and server image vulnerability scan failed on
`sharp@0.35.4`: GHSA-wq5f-xc86-pv6w. The aggregate E2E gate failed because it
requires the audit to pass, not because a browser test failed.

The upstream advisory identifies versions below 0.35.5 as affected and the
patched prebuilt binaries as including librsvg 2.63.2:
https://github.com/advisories/GHSA-wq5f-xc86-pv6w

## Fix

- Raise the server's minimum Sharp patch to `^0.35.5` and resolve exactly
  0.35.5 in the lockfile, including its matching cross-platform native packages
  and libvips bundles (1.3.4).
- No vulnerability exclusions, severity reductions or CI gate changes.
- Add real production-thumbnail pipeline tests for PNG, JPEG, WebP and SVG,
  including dimensions/output format and persistent cache reuse; invalid bytes
  must continue to produce no thumbnail.
- No public/native contract, migration, provider, live catalogue or CineMusic
  changes.

## Verification

The local installed native package reports Sharp 0.35.5, librsvg 2.63.2 and
libvips 8.18.7. `pnpm install --frozen-lockfile` succeeds and `pnpm audit:ci`
returns `{"provider":"npm","status":"passed"}` with the unchanged high/critical
production gate. This is not a claim that all lower-severity advisories vanish.

Final local results: server 457 tests (including the five real image pipeline
cases), shared 30, web 155, all passed. Typecheck, zero-warning lint,
production build/bundle budget, 24 CI tooling tests, documentation links and
diff whitespace checks passed.

Commands:

```sh
pnpm audit:ci
pnpm --filter @cinedrive/server test
pnpm --filter @cinedrive/shared test
pnpm --filter @cinedrive/web exec vitest run --maxWorkers=1
pnpm typecheck
pnpm lint
pnpm build
pnpm ci:test
pnpm docs:check
git diff --check
```

Local Docker is installed but its daemon is not running, so local container
build/Trivy verification is not claimed. The updated PR's GitHub Actions image
scan must confirm the Linux runtime result. No merge or deployment is performed.
