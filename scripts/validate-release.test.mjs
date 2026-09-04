import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./validate-release.mjs', import.meta.url));
const packageFiles = [
  'package.json',
  'apps/server/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
];
const changelogFor = (version) => `# Changelog

## [Unreleased]

- Future work, not release notes.

## [${version}] - 2026-09-03

### Security

- Patched production dependencies.

[Unreleased]: https://example.test/compare
[${version}]: https://example.test/release
`;

function fixture(t, { version = '1.0.0', changelog = changelogFor(version), versions = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cinedrive-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of packageFiles) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), JSON.stringify({ version: versions[file] ?? version }));
  }
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  return (...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
}

test('accepts matching stable versions and a tag without creating or publishing anything', (t) => {
  const run = fixture(t);
  assert.equal(run().status, 0);
  assert.equal(run('--', '--tag', 'v1.0.0').status, 0);
});

test('accepts a valid prerelease', (t) => {
  assert.equal(fixture(t, { version: '1.1.0-rc.1' })('--tag', 'v1.1.0-rc.1').status, 0);
});

test('selects a new minor release without including the previous stable release', (t) => {
  const changelog = changelogFor('1.1.0').replace(
    '[Unreleased]:',
    '## [1.0.0] - 2026-09-03\n\n- Previous stable release.\n\n[Unreleased]:',
  );
  const run = fixture(t, { version: '1.1.0', changelog });
  const result = run('--tag', 'v1.1.0', '--notes');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '### Security\n\n- Patched production dependencies.\n');
  assert.equal(run('--tag', 'v1.0.0').status, 1);
});

for (const file of packageFiles.slice(1)) {
  test(`rejects version drift in ${file}`, (t) => {
    const result = fixture(t, { versions: { [file]: '1.0.1' } })();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected 1\.0\.0/);
  });
}

for (const version of ['01.0.0', '1.0', '1.0.0-rc.01']) {
  test(`rejects invalid SemVer ${version}`, (t) => {
    const result = fixture(t, { version })();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not valid SemVer/);
  });
}

for (const heading of [
  '### [1.0.0] - 2026-09-03',
  'Mention ## [1.0.0] in prose',
  '## [1.0.1] - 2026-09-03',
]) {
  test(`does not accept a misleading or missing release heading: ${heading}`, (t) => {
    assert.equal(fixture(t, { changelog: `${heading}\n\n- A change.\n` })().status, 1);
  });
}

test('rejects duplicate release sections', (t) => {
  const result = fixture(t, {
    changelog: changelogFor('1.0.0') + '\n## [1.0.0] - 2026-09-03\n- Duplicate.\n',
  })();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exactly one release section/);
});

for (const date of ['', ' - pending', ' - 2026-02-30']) {
  test(`rejects an absent, unfinished, or impossible date: ${date}`, (t) => {
    const result = fixture(t, { changelog: `## [1.0.0]${date}\n\n- A change.\n` })();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /valid YYYY-MM-DD/);
  });
}

test('rejects an empty release even when a later release has entries', (t) => {
  const result = fixture(t, {
    changelog:
      '## [1.0.0] - 2026-09-03\n\n### Added\n\n## [0.9.0] - 2026-09-01\n\n- Older change.\n',
  })();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /at least one change entry/);
});

for (const args of [
  ['--tag'],
  ['--tag', 'v1.0.1'],
  ['--unknown'],
  ['--notes', '--notes'],
  ['--tag', 'v1.0.0', '--tag', 'v1.0.0'],
]) {
  test(`rejects invalid arguments ${args.join(' ')}`, (t) => {
    assert.equal(fixture(t)(...args).status, 1);
  });
}

test('prints only the validated release notes, without adjacent releases or reference links', (t) => {
  const changelog = changelogFor('1.0.0').replace(
    '[Unreleased]:',
    '## [0.9.0] - 2026-09-01\n\n- Older work.\n\n[Unreleased]:',
  );
  const result = fixture(t, { changelog: changelog.replaceAll('\n', '\r\n') })(
    '--tag',
    'v1.0.0',
    '--notes',
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '### Security\n\n- Patched production dependencies.\n');
});

test('strips the reference-link footer of the final release', (t) => {
  assert.equal(
    fixture(t)('--notes').stdout,
    '### Security\n\n- Patched production dependencies.\n',
  );
});

test('does not emit release notes when validation fails', (t) => {
  const result = fixture(t)('--notes', '--tag', 'v2.0.0');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
});
