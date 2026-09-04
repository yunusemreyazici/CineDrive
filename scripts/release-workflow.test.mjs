import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
// Deliberately scoped to this workflow's two-space job layout (not a YAML parser).
const headers = [...workflow.matchAll(/^  ([\w-]+):\n/gm)];
const jobs = new Map(headers.map((m, i) => [m[1], workflow.slice(m.index, headers[i + 1]?.index)]));
const script = fileURLToPath(new URL('./merge-release-images.sh', import.meta.url));
const image = 'ghcr.io/yunusemreyazici/cinedrive-server';
const amd64 = `sha256:${'a'.repeat(64)}`;
const arm64 = `sha256:${'b'.repeat(64)}`;
const indexDigest = `sha256:${'c'.repeat(64)}`;
const index = () => ({
  schemaVersion: 2,
  manifests: [
    { digest: amd64, platform: { os: 'linux', architecture: 'amd64' } },
    { digest: arm64, platform: { os: 'linux', architecture: 'arm64' } },
  ],
});

test('dry runs and tag builds cover both components on matching native runners', () => {
  assert.doesNotMatch(workflow, /setup-qemu|continue-on-error/);
  for (const name of ['dry-run', 'publish-platform']) {
    const job = jobs.get(name);
    assert.match(job, /runs-on: \$\{\{ matrix.runner \}\}/);
    assert.match(job, /name: \[server, web\]/);
    assert.match(job, /arch: \[amd64, arm64\]/);
    assert.match(job, /arch: amd64\n            runner: ubuntu-24\.04\n/);
    assert.match(job, /arch: arm64\n            runner: ubuntu-24\.04-arm\n/);
    assert.match(job, /platforms: linux\/\$\{\{ matrix.arch \}\}/);
    assert.match(job, /file: Dockerfile\.\$\{\{ matrix.name \}\}/);
    assert.match(job, /scope=release-\$\{\{ matrix.name \}\}-\$\{\{ matrix.arch \}\}/);
    assert.match(job, /^    needs: validate$/m);
    assert.match(job, /fail-fast: false/);
  }
});

test('PR and manual dry runs cannot publish and exercise built runtime binaries', () => {
  const job = jobs.get('dry-run');
  assert.match(job, /if: github.event_name != 'push' \|\| github.ref_type != 'tag'/);
  assert.doesNotMatch(job, /: write|login-action|push: true|push=true/);
  assert.match(job, /push: false\n          load: true/);
  assert.match(job, /prisma migrate deploy/);
  assert.match(job, /process.arch/);
  assert.match(job, /--add-host server:127.0.0.1 .* nginx -t/);
});

test('tag builds publish only by digest; final index waits for the entire native matrix', () => {
  for (const name of ['publish-platform', 'publish', 'release']) {
    assert.match(jobs.get(name), /if: github.event_name == 'push' && github.ref_type == 'tag'/);
    assert.doesNotMatch(jobs.get(name), /if: always/);
  }
  const build = jobs.get('publish-platform');
  assert.match(build, /push-by-digest=true,name-canonical=true,push=true/);
  assert.doesNotMatch(build, /id-token: write|attestations: write|artifact-metadata: write/);
  const publish = jobs.get('publish');
  assert.match(publish, /^    needs: publish-platform$/m);
  assert.match(publish, /run: bash scripts\/merge-release-images.sh/);
  assert.match(publish, /pattern: image-digests-\$\{\{ matrix.name \}\}-\*/);
  assert.doesNotMatch(publish, /run-id:|repository:|build-push-action/);
  assert.equal(
    (publish.match(/subject-digest: \$\{\{ steps.push.outputs.digest \}\}/g) ?? []).length,
    2,
  );
  assert.match(publish, /cosign sign --yes "\$\{IMAGE\}@\$\{DIGEST\}"/);
  assert.match(jobs.get('release'), /^    needs: publish$/m);
});

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cinedrive-index-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const digests = join(root, 'digests');
  mkdirSync(digests);
  if (!options.missing) writeFileSync(join(digests, 'digest-amd64.txt'), options.amd64 ?? amd64);
  writeFileSync(join(digests, 'digest-arm64.txt'), options.arm64 ?? arm64);
  if (options.extra) writeFileSync(join(digests, 'extra.txt'), 'unexpected');
  writeFileSync(join(root, 'preview.json'), JSON.stringify(options.preview ?? index()));
  writeFileSync(join(root, 'published.json'), JSON.stringify(options.published ?? index()));
  // Run the real shell script; only Docker/registry operations are replaced.
  writeFileSync(
    join(root, 'docker'),
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = process.env.RUNNER_TEMP;
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(args) + '\\n');
if (args.includes('--dry-run')) {
  if (process.env.FAIL_PREVIEW === '1') process.exit(1);
  process.stdout.write(fs.readFileSync(path.join(root, 'preview.json')));
} else if (args.includes('create')) {
  if (process.env.FAIL_PUSH === '1') process.exit(1);
  fs.writeFileSync(args[args.indexOf('--metadata-file') + 1], JSON.stringify({
    'containerimage.descriptor': { digest: process.env.INDEX_DIGEST }
  }));
} else if (args.includes('inspect')) {
  if (process.env.FAIL_INSPECT === '1') process.exit(1);
  process.stdout.write(fs.readFileSync(path.join(root, 'published.json')));
} else process.exit(1);
`,
    { mode: 0o755 },
  );
  const output = join(root, 'output');
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      IMAGE: options.image ?? image,
      METADATA: JSON.stringify({
        tags: options.tags ?? [`${image}:1.0.0`, `${image}:1.0`, `${image}:sha-commit`],
      }),
      DIGEST_DIR: digests,
      RUNNER_TEMP: root,
      GITHUB_OUTPUT: output,
      INDEX_DIGEST: options.indexDigest ?? indexDigest,
      FAIL_PREVIEW: options.failPreview ? '1' : '0',
      FAIL_PUSH: options.failPush ? '1' : '0',
      FAIL_INSPECT: options.failInspect ? '1' : '0',
    },
  });
  const callsFile = join(root, 'calls.jsonl');
  const calls = existsSync(callsFile)
    ? readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse)
    : [];
  return { result, calls, output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
}

test('merges verified platform digests and emits only the validated combined digest', (t) => {
  const { result, calls, output } = fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], [
    'buildx',
    'imagetools',
    'create',
    '--dry-run',
    `${image}@${amd64}`,
    `${image}@${arm64}`,
  ]);
  assert.ok(calls[1].includes(`${image}:1.0.0`));
  assert.ok(calls[1].includes(`${image}:sha-commit`));
  assert.equal(calls[2].at(-1), `${image}@${indexDigest}`);
  assert.equal(output, `digest=${indexDigest}\n`);
});

for (const [name, options] of Object.entries({
  'missing platform': { missing: true },
  'extra file': { extra: true },
  'identical digests': { arm64: amd64 },
  'malformed digest': { arm64: '--tag=unexpected' },
  'multiline digest': { arm64: `${arm64}\n${amd64}` },
  'wrong repository': { image: 'ghcr.io/other/image' },
  'empty tags': { tags: [] },
  'non-string tag': { tags: [`${image}:1.0.0`, null] },
  'wrong tag repository': { tags: ['ghcr.io/other/image:1.0.0'] },
  'malformed tag': { tags: [`${image}:bad tag`] },
})) {
  test(`rejects ${name} before any registry operation`, (t) => {
    const { result, calls, output } = fixture(t, options);
    assert.notEqual(result.status, 0);
    assert.deepEqual(calls, []);
    assert.equal(output, '');
  });
}

for (const [name, preview] of Object.entries({
  'missing ARM64 descriptor': { ...index(), manifests: index().manifests.slice(0, 1) },
  'duplicate AMD64 descriptor': {
    ...index(),
    manifests: [index().manifests[0], index().manifests[0]],
  },
  'wrong platform digest': {
    ...index(),
    manifests: [index().manifests[0], { ...index().manifests[1], digest: amd64 }],
  },
  'wrong operating system': {
    ...index(),
    manifests: [
      index().manifests[0],
      { digest: arm64, platform: { os: 'windows', architecture: 'arm64' } },
    ],
  },
})) {
  test(`rejects ${name} before moving release tags`, (t) => {
    const { result, calls, output } = fixture(t, { preview });
    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 1);
    assert.equal(output, '');
  });
}

for (const options of [
  { failPreview: true },
  { failPush: true },
  { failInspect: true },
  { indexDigest: 'invalid' },
  { published: { manifests: [] } },
]) {
  test(`does not emit an attestable digest after failure: ${JSON.stringify(options)}`, (t) => {
    const { result, output } = fixture(t, options);
    assert.notEqual(result.status, 0);
    assert.equal(output, '');
  });
}
