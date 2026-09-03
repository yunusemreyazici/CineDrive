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

function requestedOptions() {
  const args = process.argv.slice(2).filter((argument) => argument !== '--');
  const options = { tag: undefined, notes: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--tag' && !options.tag && args[index + 1]?.startsWith('v')) {
      options.tag = args[++index];
    } else if (argument === '--notes' && !options.notes) {
      options.notes = true;
    } else {
      fail(`invalid argument(s); use [--tag v<major>.<minor>.<patch>] [--notes]`);
      break;
    }
  }
  return options;
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

const changelog = readFileSync(resolve(repositoryRoot, 'CHANGELOG.md'), 'utf8').replaceAll(
  '\r\n',
  '\n',
);
const headings = [...changelog.matchAll(/^## \[([^\]\n]+)\](?: - ([^\n]+))?$/gm)];
const releases = headings.filter((heading) => heading[1] === rootVersion);
let releaseNotes = '';
if (releases.length !== 1) {
  fail(`CHANGELOG.md must have exactly one release section for ${rootVersion}`);
} else {
  const heading = releases[0];
  const date = heading[2];
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== date
  ) {
    fail(`CHANGELOG.md release ${rootVersion} needs a valid YYYY-MM-DD date`);
  }

  // Only the selected release belongs in GitHub notes, never Unreleased,
  // another release, or the changelog's reference-link footer.
  releaseNotes = changelog
    .slice(heading.index + heading[0].length)
    .split(/^## /m)[0]
    .replace(/^\[[^\]\n]+\]:[^\n]*$/gm, '')
    .trim();
  if (!/^[-*] \S/m.test(releaseNotes)) {
    fail(`CHANGELOG.md release ${rootVersion} needs at least one change entry`);
  }
}

const { tag, notes } = requestedOptions();
if (tag && tag !== `v${rootVersion}`) {
  fail(`tag ${tag} does not match package version v${rootVersion}`);
}

if (!process.exitCode) {
  console.log(
    notes
      ? releaseNotes
      : `Release metadata is consistent for ${rootVersion}${tag ? ` (${tag})` : ' (dry run)'}.`,
  );
}
