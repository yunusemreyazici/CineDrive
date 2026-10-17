# Collaborative playlists in the normal library — 2026-10-17

## Changes

- Normal music overview, sync, playlist directory/detail now include accepted playlist memberships. Pending invitations stay in Studio's invitation directory until explicitly accepted. The legacy owner-only write routes remain owner-only.
- Additive collaboration metadata includes owner name, current user's role, accepted participant count, content version and inaccessible-track count. Detail items optionally expose `addedBy: { id, name }`.
- All normal playlist responses filter tracks using existing library access and active-file rules. A playlist membership never grants library/streaming permission or leaks hidden track IDs. Incomplete workshops remain read-only.
- HTTPS invitation links use a random 32-byte base64url token, SHA-256 hash at rest, seven-day expiry and owner-only rotation/revocation. Authenticated preview/accept use POST bodies. Preview exposes only playlist name/count, owner and expiry, never track metadata or membership lists. Joining preserves existing listener roles and is idempotent. Removing another member invalidates the current invitation link.
- Existing journal/change feed is reused; membership changes update the playlist revision. New occurrences receive the actor as contributor; reorder preserves attribution. Historical entries remain null.
- Public `/music/playlist-invite#token` landing page does not call APIs or join automatically. It opens CineMusic or offers a copy/paste fallback. AASA includes the route. The token fragment is not sent in HTTP paths.

## Main modules

- `music-playlist-invitation.service.ts`: bounded token lifecycle and explicit acceptance.
- `music-playlist-presentation.service.ts`: permission-filtered normal playlist summaries.
- Existing `music-studio.service.ts` / journal: version reuse and contributor persistence.
- `music-studio.routes.ts`: invitation endpoints and additive participants.
- `music.routes.ts`: normal library integration without widening legacy writes.
- Shared optional DTOs; `PlaylistInvitationPage.tsx` and AASA for HTTPS links.

## Schema / deployment

Additive migration `20261017010000_playlist_collaboration_links` adds nullable `MusicPlaylist.invitationHash`, `invitationExpiresAt`, a unique hash index and nullable `MusicPlaylistItem.addedById` with `ON DELETE SET NULL`. No backfill guesses authors and no playlist contents are replaced. Migration upgrade tests verify preservation of existing data, not just fresh installs.

Use the normal backed-up migration deployment process before starting the updated server; deploy web/AASA and the updated native app as well. No new environment variables. This task did not migrate a local/live database or deploy anything.

## Verification

- `pnpm --filter @cinedrive/shared build` then `pnpm typecheck`: passed.
- `pnpm test`: **30 shared, 261 web, 539 server tests passed** (68 server test files).
- `pnpm build`: passed, including web entry bundle budget (357.46 kB raw / 106.08 kB gzip).
- Changed TypeScript/TSX ESLint with `--max-warnings 0`: passed.
- Integration regressions cover authentication, owner/editor/listener/unrelated-user access, explicit/idempotent accept, expiry/rotation/revoke, pending membership visibility, no library grants, shared normal sync/detail, hidden-track filtering, contributor preservation and stale-write conflicts.
- Landing tests verify no API calls/auto-accept, app/copy links, invalid token handling and AASA registration.

## Boundaries

This is collaborative editing, not Connect/Together. Existing Studio limits (2,000 entries, 30 members) remain. CineMusic consumes the targeted cursor feed while foreground/online; this is not background push. Editing an inaccessible-track list stays disabled for safety. Web's full Studio remains available; this new public landing is an app handoff, not an unauthenticated editing UI.

Prepared for PR #128. No production invitation was created. Native automated coverage/builds passed as documented in CineMusic; iOS XCTest launching is blocked by an Xcode OS-build parser error. Successful two-device live editing still requires verification after deployment.
