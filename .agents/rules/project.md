# Drive Cinema Project Rules

## General

- Use TypeScript strict mode.
- Do not use `any` unless unavoidable and documented.
- Do not expose Google access or refresh tokens to the frontend.
- Do not commit secrets.
- Never invent an environment variable without adding it to `.env.example`.
- Always keep package.json dependencies synchronized with imports.
- Run typecheck, tests and build after meaningful changes.
- Fix errors instead of merely reporting them.

## Architecture

- Frontend lives in `apps/web`.
- Backend lives in `apps/server`.
- Shared contracts live in `packages/shared`.
- Controllers must remain thin.
- Business logic belongs in services.
- Database access belongs in repository modules.
- API request and response types must be shared where appropriate.

## Streaming

- Never download an entire video before playback.
- Never use `arrayBuffer()` or `blob()` for video streaming.
- Preserve HTTP Range semantics.
- Preserve backpressure.
- Abort the Google Drive request when the client disconnects.
- Validate every Drive file ID against the database and library ownership.
- Never log authorization headers or Google tokens.

## Frontend

- Use TanStack Query for server state.
- Use Zustand only for client UI state.
- Every screen must include loading, empty and error states.
- Maintain keyboard accessibility and visible focus states.
- Avoid unnecessarily large React components.

## Changes

Before modifying an existing module:
1. Read the related files.
2. Identify dependencies.
3. Make the smallest coherent change.
4. Run relevant tests.
5. Report changed files and verification results.