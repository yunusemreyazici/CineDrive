# Listen Together (Birlikte Dinle)

Two authenticated accounts on one CineDrive server can listen on their own
CineMusic iOS/iPadOS/Mac Catalyst devices. This is opt-in and separate from
same-account Connect remote control. It adds no single-device playback restriction.

## First version

- The host starts a room from the current track (up to 250 queued server tracks).
- An invitation contains the server address and a 16-character random code.
  The second user signs in to that server and enters the code in Connect → Listen Together.
  Link/QR automatic joining is not implemented in this version.
- Both users need access to every queued track. Invitations do not grant library
  access; local imported files cannot join the shared queue.
- Both can append tracks or play next. The host controls play, pause, next,
  previous, seek and replacement of the queue, and removes non-current entries.
- Volume remains local. Leaving does not pause the other participant. When the
  host leaves, control moves to the remaining listener and the invite code rotates.
- Only one room per account, one device per participant, two participants per room.

## Protocol

Advertised by `GET /api/client-bootstrap` as `features.listeningTogether`.
All requests require the normal session cookie or Authorization header.
No authentication token is placed in a URL. Each operation additionally checks
both account and client ID, and library access is checked on join, add and reads.

Base path: `/api/music/listening-sessions`.

| Method    | Path            | Body/query                                                      |
| --------- | --------------- | --------------------------------------------------------------- |
| POST      | `/`             | `clientId`, `trackIds`, optional `index`, `position`, `playing` |
| POST      | `/join`         | `clientId`, `code`                                              |
| GET       | `/:id`          | query `clientId`                                                |
| POST      | `/:id/commands` | `clientId`, `revision`, `action`, action-specific fields        |
| POST      | `/:id/ready`    | `clientId`, `epoch`                                             |
| POST      | `/:id/leave`    | `clientId`                                                      |
| WebSocket | `/:id/events`   | query `clientId`, session authentication headers                |

Snapshot responses contain `session` and per-user authorized track DTOs in
`tracks`. `session` includes `revision`, transport `epoch`, queue entry IDs,
current index, position, playing/preparing, `startAt`, `serverTime` (Unix ms),
members (including ready/online state), and the host-only `inviteCode`.
Repeated tracks have distinct queue entry IDs.

Commands use optimistic revision checks (409 for stale edits). Actions are
`play`, `pause`, `seek` (`position`), `next`, `previous`, `replace` (`trackIds`,
`index`, `position`), `add` (`trackIds`, optional `playNext`), and `remove` (`itemId`).
The guest may only add. Shuffle, repeat and reordering are not included.

The socket emits `{ "type": "changed" }`; clients retrieve a fresh snapshot.
Commands stay on HTTP, so authorization, validation and the isolated Connect
rate-limit bucket apply. Invitation attempts additionally have a dedicated
12/minute IP budget. Connections send server pings every 20 seconds and recheck
login and library access. Browser Origin must match Host; native connections
without Origin authenticate with their session headers.

Play, seek and track changes begin a new preparation epoch. Every participant
acknowledges readiness. Once all are ready, the server schedules `startAt` 1.2
seconds ahead. Clients estimate the server clock from HTTP midpoint samples,
start locally, and correct significant drift rather than seeking every tick.
A failed/offline participant can hold preparation; participants may retry sync or
leave. Current playback continues during a brief socket disconnect. This is for
remote social listening, not phase-aligned speakers in the same room.

## Deployment and limits

Update the server **and proxy configuration**, then install a compatible client.
Docker nginx and `scripts/install-vps.sh` include a dedicated WebSocket Upgrade
location with buffering disabled. Existing custom nginx configurations must
forward Upgrade/Connection for `/:id/events` too. No database migration is needed.
Older servers do not advertise the feature and compatible clients hide its entry.

Live rooms are held in the single server process, bounded to 500 rooms, 250 queue
entries and eight sockets per room. They survive client reconnects but not a server
restart; they expire after 30 minutes without access or a six-hour maximum lifetime.
Use a single server replica for this version. Horizontal scaling needs a shared
room/event store. No production deployment is performed by adding this code.

The app persists only an owner/server/client-scoped room ID for reconnect. A
revoked session or removed library permission is not a way to continue streaming:
normal authenticated music endpoints continue enforcing access independently.

## Invitation links (companion CineMusic client)

The public web route `/music/listen/:code` displays the invitation code without
requiring a web login. It does not fetch participant or library data. The user can
copy the code or choose Open in CineMusic, which wraps the same HTTPS URL in
`cinemusic://listen?url=...`. The app validates the URL, displays the target server
and requires an explicit Join action using the signed-in account's existing
permissions. An invalid or expired room is reported by the authenticated join API.

Deploy the web build and updated `public/.well-known/apple-app-site-association`
together. The latter adds `/music/listen/*` to the existing CineMusic association.
The signed app currently declares `cine.yunusemreyazici.com`; other server domains
need a matching signed associated-domain entitlement for direct Universal Links.
The web app button and manual-code entry remain alternatives. Do not rewrite the
AASA request to the SPA, and keep its JSON content type. Physical-device Universal
Link routing must be checked after deployment because Apple caches associations.

No API or database change is required for invitation links. Codes are invitation
secrets; recipients still need access to all queued music. QR invitations are not
included in this change.
