import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OSV_VERSION = '2.5.1';
// Official release asset digests; download and hash verification precede execution.
export const OSV_ASSETS = {
  'linux-x64': ['linux_amd64', 'f9f25499a2c8cc367b3af45df2ea7eeca7fbccceab9c35079968f4b3652194be'],
  'linux-arm64': [
    'linux_arm64',
    '3d0f5aa5a6baa8eb32bcef247388e149ef6030a6634ccae6fa0d62681fb27a6d',
  ],
  'darwin-arm64': [
    'darwin_arm64',
    '75c44d6332f892a1e56286f4105a98ed751ae28d215ca0a8b65cc00d84103054',
  ],
  'darwin-x64': [
    'darwin_amd64',
    '9f89beb6c3d784893cb1cae0a3d56c529bfe91075418c2f9440c45b79654198b',
  ],
};

function jsonResult(result) {
  if (result.error || result.signal || !Number.isInteger(result.status)) {
    throw new Error('Scanner process did not complete normally');
  }
  return JSON.parse(result.stdout);
}

export function classifyNpm(result) {
  let report;
  try {
    report = jsonResult(result);
  } catch {
    return 'blocked';
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) return 'blocked';
  // Findings and malformed/mixed reports are never eligible for fallback.
  if (report.error) {
    if (result.status === 0 || report.metadata || report.advisories || report.vulnerabilities)
      return 'blocked';
    const { code, message } = report.error;
    if (typeof message !== 'string') return 'blocked';
    if (code === 23 && message === 'The operation was aborted due to timeout') return 'unavailable';
    if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH'].includes(code))
      return 'unavailable';
    if (
      code === 'ERR_PNPM_AUDIT_BAD_RESPONSE' &&
      /^The audit endpoint \(at https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/security\/advisories\/bulk\) responded with (408|429|500|502|503|504):/.test(
        message,
      )
    )
      return 'unavailable';
    return 'blocked';
  }
  const counts = report.metadata?.vulnerabilities;
  if (
    !counts ||
    !['info', 'low', 'moderate', 'high', 'critical'].every(
      (key) => Number.isInteger(counts[key]) && counts[key] >= 0,
    )
  )
    return 'blocked';
  if (result.status !== 0 || counts.high > 0 || counts.critical > 0) return 'blocked';
  if (
    !report.advisories ||
    typeof report.advisories !== 'object' ||
    Array.isArray(report.advisories)
  )
    return 'blocked';
  if (
    Object.values(report.advisories).some(
      (v) => !v || !['info', 'low', 'moderate'].includes(v.severity),
    )
  )
    return 'blocked';
  return 'clean';
}

export function lockedPackages(text) {
  // A deliberately narrow inventory guard for pnpm's canonical v9 packages
  // mapping, not a general YAML parser. New layouts/non-registry keys fail closed.
  if (!/^lockfileVersion: ['"]9\.0['"]$/m.test(text))
    throw new Error('Unsupported lockfile version');
  const section = text.match(/^packages:\n([\s\S]*?)(?=^[^\s#]|$(?![\s\S]))/m)?.[1];
  if (!section) throw new Error('Missing lockfile packages mapping');
  const packages = new Set();
  for (const line of section.split('\n').filter((line) => /^  \S/.test(line))) {
    let key = line.match(/^  (.+):(?: \{\})?$/)?.[1];
    if (key?.startsWith("'") && key.endsWith("'")) key = key.slice(1, -1);
    else if (key?.startsWith('"') && key.endsWith('"')) key = JSON.parse(key);
    if (
      !key ||
      !/^(@[\w.-]+\/[\w.-]+|[\w.-]+)@\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(key)
    ) {
      throw new Error(`Unsupported lockfile package entry: ${line}`);
    }
    if (packages.has(key)) throw new Error('Duplicate lockfile package');
    packages.add(key);
  }
  if (!packages.size) throw new Error('Empty lockfile inventory');
  return packages;
}

export function evaluateOsv(result, expected, lockfile) {
  const report = jsonResult(result);
  if (
    ![0, 1].includes(result.status) ||
    report?.error ||
    !Array.isArray(report?.results) ||
    report.results.length !== 1 ||
    (report.experimental_generic_findings !== undefined &&
      (!Array.isArray(report.experimental_generic_findings) ||
        report.experimental_generic_findings.length !== 0))
  )
    throw new Error('Incomplete OSV scan');
  const source = report.results[0];
  if (
    source.source?.type !== 'lockfile' ||
    typeof source.source.path !== 'string' ||
    resolve(source.source.path) !== resolve(lockfile) ||
    !Array.isArray(source.packages)
  ) {
    throw new Error('OSV report does not describe the requested lockfile');
  }
  const seen = new Set();
  const blockers = [];
  let findings = 0;
  for (const entry of source.packages) {
    const pkg = entry.package;
    const key = `${pkg?.name}@${pkg?.version}`;
    if (pkg?.ecosystem !== 'npm' || !expected.has(key) || seen.has(key))
      throw new Error('Unexpected/duplicate OSV package');
    seen.add(key);
    const vulns = entry.vulnerabilities === undefined ? [] : entry.vulnerabilities;
    const groups = entry.groups === undefined ? [] : entry.groups;
    if (!Array.isArray(vulns) || !Array.isArray(groups)) throw new Error('Invalid OSV findings');
    findings += vulns.length;
    const ids = new Set(vulns.map((v) => v?.id));
    if (ids.size !== vulns.length || [...ids].some((id) => typeof id !== 'string' || !id))
      throw new Error('Invalid vulnerability IDs');
    const grouped = new Set();
    for (const group of groups) {
      if (
        !Array.isArray(group.ids) ||
        !group.ids.length ||
        group.ids.some((id) => !ids.has(id) || grouped.has(id))
      ) {
        throw new Error('Invalid OSV vulnerability group');
      }
      group.ids.forEach((id) => grouped.add(id));
      // Use OSV-Scanner's calculated CVSS maximum, not an independently guessed
      // CVSS formula. Missing/unknown scores require review rather than a pass.
      const score = group.max_severity;
      if (typeof score !== 'string' || !/^(?:\d(?:\.\d+)?|10(?:\.0+)?)$/.test(score)) {
        throw new Error('Missing or unknown OSV severity');
      }
      if (Number(score) >= 7) blockers.push(`${key}: ${group.ids.join(', ')} (CVSS ${score})`);
    }
    if (grouped.size !== ids.size) throw new Error('Ungrouped OSV vulnerability');
  }
  if (seen.size !== expected.size) throw new Error('OSV did not scan every locked package');
  if ((result.status === 0) !== (findings === 0)) throw new Error('OSV exit code/report mismatch');
  return { packages: seen.size, findings, blockers };
}

export function verifyScanner(bytes, digest) {
  if (createHash('sha256').update(bytes).digest('hex') !== digest)
    throw new Error('OSV binary checksum mismatch');
}

async function installScanner(directory) {
  const asset = OSV_ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('Unsupported OSV binary platform');
  const response = await fetch(
    `https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}/osv-scanner_${asset[0]}`,
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok) throw new Error(`OSV download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyScanner(bytes, asset[1]);
  const path = join(directory, 'osv-scanner');
  writeFileSync(path, bytes, { flag: 'wx' });
  chmodSync(path, 0o700);
  return path;
}

export async function runAudit({ root, reports, run, scanner }) {
  const lockfile = join(root, 'pnpm-lock.yaml');
  const lockText = readFileSync(lockfile, 'utf8');
  const npm = run('pnpm', [
    'audit',
    '--prod',
    '--audit-level',
    'high',
    '--json',
    '--fetch-timeout=20000',
    '--fetch-retries=2',
    '--fetch-retry-mintimeout=5000',
    '--fetch-retry-maxtimeout=10000',
  ]);
  writeFileSync(join(reports, 'npm-audit.json'), npm.stdout ?? '');
  writeFileSync(join(reports, 'npm-audit.stderr.txt'), npm.stderr ?? '');
  const decision = classifyNpm(npm);
  if (decision === 'blocked')
    throw new Error(
      'npm audit reported findings or an unrecognized/incomplete failure; no fallback allowed',
    );
  if (decision === 'clean') return { provider: 'npm', status: 'passed' };
  console.warn(
    'npm audit service unavailable; using verified OSV-Scanner on the entire lockfile (including dev/optional packages).',
  );
  const expected = lockedPackages(lockText);
  const executable = await scanner();
  const config = join(reports, 'osv-scanner.toml');
  writeFileSync(config, '# Intentionally empty: no vulnerability or package exclusions.\n');
  const osv = run(executable, [
    'scan',
    'source',
    `--lockfile=${lockfile}`,
    '--format=json',
    '--all-packages',
    '--all-vulns',
    '--no-call-analysis=go,rust',
    '--no-resolve',
    `--config=${config}`,
  ]);
  writeFileSync(join(reports, 'osv-audit.json'), osv.stdout ?? '');
  writeFileSync(join(reports, 'osv-audit.stderr.txt'), osv.stderr ?? '');
  if (readFileSync(lockfile, 'utf8') !== lockText) throw new Error('Lockfile changed during audit');
  const evaluation = evaluateOsv(osv, expected, lockfile);
  if (evaluation.blockers.length)
    throw new Error(`OSV blocking vulnerabilities:\n${evaluation.blockers.join('\n')}`);
  return {
    provider: 'osv',
    version: OSV_VERSION,
    status: 'passed',
    lockfileSha256: createHash('sha256').update(lockText).digest('hex'),
    ...evaluation,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = mkdtempSync(join(tmpdir(), 'cinedrive-audit-'));
  const reports = join(directory, 'reports');
  mkdirSync(reports);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `report_dir=${reports}\n`);
  try {
    const result = await runAudit({
      root: process.cwd(),
      reports,
      run: (command, args) =>
        spawnSync(command, args, {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 180_000,
          killSignal: 'SIGKILL',
          maxBuffer: 20 * 1024 * 1024,
        }),
      scanner: () => installScanner(directory),
    });
    writeFileSync(join(reports, 'verdict.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    writeFileSync(
      join(reports, 'verdict.json'),
      JSON.stringify({ status: 'failed', reason: error.message }),
    );
    console.error(error.message);
    process.exitCode = 1;
  }
  console.log(`Audit reports: ${reports}`);
}
