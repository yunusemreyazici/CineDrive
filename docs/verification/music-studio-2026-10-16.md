# Music Studio and collaborative playlists — 2026-10-16

## Storage and API

Additive migration `20261016000000_music_studio` adds `MusicPlaylistMembership` (playlist/user compound key, accepted flag, editor/listener role, cascading foreign keys) and `MusicStudio` (account-owned bounded JSON with revision CAS). Existing playlist records, item IDs, files, favorites and history are not migrated or deleted.

Shared strict Zod schemas bound every input: recording families (200 × 30), checkpoints (30 × 500), workshop (2,000), transfer (500), invitations and refinement IDs. Arbitrary filter/query fragments are not accepted.

Authenticated, private/no-store endpoints:

- `GET/PUT /api/music/studio/profile`: private recording families/checkpoints, revision-checked updates and accessible-track validation.
- `GET /api/music/studio/playlists`: bounded directory with pending invitations.
- `GET /api/music/studio/playlists/:id`: owner/accepted member read; safely chunked hydration filters inaccessible tracks. Reports hidden count and disables editing when the actor cannot access all occurrences.
- `PUT /api/music/studio/playlists/:id/items`: owner/editor only, version hash, occurrence IDs, accessible tracks for actor and list owner, foreign occurrence rejection.
- `POST .../:id/transfer`: copy/move with source and target version checks, write locks, one transaction, fresh destination occurrence IDs.
- `POST .../:id/invite`: owner only, existing enabled account, 30-member bound, invitation rate limit. Reinviting cannot silently change accepted permissions.
- `POST .../:id/accept`: only the invited authenticated account.
- `DELETE .../:id/members/:userId`: owner revoke or self leave/decline.
- `POST /api/music/discovery/ai/refine`: per-user original mix lookup, retained-ID validation, original server-held hard intent, catalogue/history/local selection, safe hydration. No AI call and no client-supplied SQL/intent override.

Legacy playlist APIs remain owner-only. Invitation never creates a library membership or grants stream access. Listener permissions and unrecognized roles fail closed for mutation. SQLite writer locks precede version/permission reads. Edit/transfer logic is isolated in `music-playlist-workshop.service.ts`; common policy/version/validation lives in `music-studio.service.ts`.

## Discovery and privacy

User-confirmed recording families select the preferred available eligible version. Hard filters run before family selection in prompt/editorial mixes; an ineligible preferred version is never injected. Standard discovery selects family versions within each filtered pool. Studio revision invalidates normal/editorial caches. Existing no-family behavior, weighted selection, diversity/history and radio APIs remain intact.

Refinement caches are bounded to 100 results for 30 minutes, user-scoped and ephemeral. Replaced IDs are excluded; insufficient eligible alternatives shorten the mix. Explicitly kept tracks are rechecked for access/hard eligibility and contribute artist context. Provider output remains intent-only; no added catalogue/lyrics/history payload is sent externally.

## Verification

- Real migration chain applied by Vitest global setup to disposable SQLite; no local or production DB modified.
- Final full server suite: **68 files / 525 tests passed**. Log: `/private/tmp/cinedrive-studio-full-final.log`.
- Final targeted studio + AI/editorial/discovery suite: **4 files / 67 tests passed** (10 Studio tests).
- Shared: **4 files / 30 tests passed**.
- Server/shared/web typecheck, shared/server build and changed-file ESLint passed.
- Native counterpart: 40 unit + 2 UI tests and iOS/Catalyst builds passed (see CineMusic verification report).

Studio regressions cover unauthenticated/unrelated users, pending vs accepted membership, listener/editor/owner rights, unknown-role denial, library isolation, stale and competing updates, occurrence undo, transfer rollback, foreign IDs, size bounds, profile isolation, malformed optional profile recovery, deterministic provider-free refinement and hard-year preservation. Provider is mocked; no external provider lookup.

```sh
pnpm --filter @cinedrive/shared build
pnpm --filter @cinedrive/server prisma:generate
pnpm --filter @cinedrive/server test
pnpm --filter @cinedrive/server exec vitest run tests/music-studio.test.ts tests/music-ai-editorial.test.ts tests/music-discovery.test.ts tests/music-ai-playlist.test.ts
pnpm --filter @cinedrive/shared test
pnpm -r run typecheck
pnpm --filter @cinedrive/server build
pnpm exec eslint apps/server/src/routes/music-studio.routes.ts apps/server/src/services/music-playlist-workshop.service.ts apps/server/src/services/music-studio.service.ts apps/server/src/services/music-ai-playlist.service.ts apps/server/src/services/music-ai-editorial.service.ts apps/server/src/services/music-discovery.service.ts apps/server/src/routes/music.routes.ts apps/server/tests/music-studio.test.ts apps/server/tests/music-ai-editorial.test.ts packages/shared/src/schemas/music-studio.schema.ts --max-warnings 0
git diff --check
```

## Deliberate boundaries

Manual recording links and explicit queue saves; no fuzzy automatic merging, audio analysis, live push updates, email delivery, public invite tokens, or file deletion. Collaboration currently lives in native Studio; existing web/legacy playlist ownership remains unchanged. Only prompt-generated mixes expose interactive refinement. Directory currently lists the most recently updated 200 accessible/invited playlists. UI discloses limits and online requirement. Real deployed two-device collaboration QA remains a release validation step; this change was not deployed or committed.
