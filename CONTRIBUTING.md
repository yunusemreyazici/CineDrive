# Contributing to CineDrive

Thanks for helping improve CineDrive. Keep changes focused and use an issue to discuss substantial features or behavior changes before investing in an implementation.

## Development setup

Follow [local installation](docs/INSTALLATION.md#local-development) and [configuration](docs/CONFIGURATION.md) first; [Development](docs/DEVELOPMENT.md) covers architecture and test coverage. After cloning the repository:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm --filter @cinedrive/server prisma:deploy
```

Use only disposable data and credentials for development. Never commit `.env` files, tokens, API keys, personal media, database files, or production logs.

## Making a change

- Create a focused branch and avoid unrelated refactors.
- Preserve existing public API and UI behavior unless the change explicitly requires otherwise.
- Add or update tests for behavior changes and bug fixes.
- Keep shared API contracts in `packages/shared` when both the server and clients use them.
- Follow the security and streaming constraints already documented in the codebase.

Before submitting a pull request, run:

```bash
pnpm -r run typecheck
pnpm lint
pnpm -r run test
pnpm build
```

Run `pnpm test:e2e` when the change affects a user flow, API integration, playback, or deployment behavior.

## Pull requests

For documentation changes, keep English and Turkish guides aligned and run `pnpm docs:check`. When changing the link checker, also run `pnpm docs:test`.

Describe the problem and solution, link related issues, and list the verification you performed. Keep commits free of generated caches and local data. By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue or pull request.
