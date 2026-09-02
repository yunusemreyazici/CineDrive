import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const repositoryRoot = process.cwd();
const packageFiles = [
  'package.json',
  'apps/server/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
];

// SemVer 2.0.0 without a leading "v". Numeric prerelease identifiers may not
// contain leading zeroes.
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  console.error(`Release validation failed: ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), 'utf8'));
}

function requestedTag() {
  const args = process.argv.slice(2).filter((argument) => argument !== '--');
  const tagIndex = args.indexOf('--tag');

  if (tagIndex === -1) {
    if (args.length > 0) {
      fail(`unknown argument(s): ${args.join(' ')}`);
    }
    return undefined;
  }

  if (args.length !== 2 || !args[tagIndex + 1]) {
    fail('use --tag v<major>.<minor>.<patch>');
    return undefined;
  }

  return args[tagIndex + 1];
}

const manifests = packageFiles.map((relativePath) => ({
  relativePath,
  manifest: readJson(relativePath),
}));
const rootVersion = manifests[0].manifest.version;

if (typeof rootVersion !== 'string' || !semverPattern.test(rootVersion)) {
  fail(`package.json version "${String(rootVersion)}" is not valid SemVer`);
}

for (const { relativePath, manifest } of manifests.slice(1)) {
  if (manifest.version !== rootVersion) {
    fail(`${relativePath} has version ${String(manifest.version)}; expected ${rootVersion}`);
  }
}

const changelog = readFileSync(resolve(repositoryRoot, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## [${rootVersion}]`)) {
  fail(`CHANGELOG.md has no release section for ${rootVersion}`);
}

const tag = requestedTag();
if (tag && tag !== `v${rootVersion}`) {
  fail(`tag ${tag} does not match package version v${rootVersion}`);
}

if (!process.exitCode) {
  console.log(
    `Release metadata is consistent for ${rootVersion}${tag ? ` (${tag})` : ' (dry run)'}.`,
  );
}
