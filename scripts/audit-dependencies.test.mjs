import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  classifyNpm,
  evaluateOsv,
  lockedPackages,
  runAudit,
  verifyScanner,
} from './audit-dependencies.mjs';

const lock =
  "lockfileVersion: '9.0'\npackages:\n  app-dep@1.0.0:\n    resolution: {integrity: unused}\n  '@test/dev-dep@2.0.0':\n    resolution: {integrity: unused}\nsnapshots:\n  app-dep@1.0.0: {}\n";
const expected = new Set(['app-dep@1.0.0', '@test/dev-dep@2.0.0']);
const result = (report, status = 0) => ({ status, stdout: JSON.stringify(report), stderr: '' });
const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
const clean = () => result({ advisories: {}, metadata: { vulnerabilities: { ...counts } } });
const unavailable = () =>
  result({ error: { code: 23, message: 'The operation was aborted due to timeout' } }, 1);
const pkg = (name, version) => ({ package: { name, version, ecosystem: 'npm' } });
function report(path) {
  return {
    results: [
      {
        source: { path, type: 'lockfile' },
        packages: [pkg('app-dep', '1.0.0'), pkg('@test/dev-dep', '2.0.0')],
      },
    ],
  };
}
function finding(report, severity = '7.5', index = 0) {
  report.results[0].packages[index].vulnerabilities = [{ id: 'GHSA-test' }];
  report.results[0].packages[index].groups = [{ ids: ['GHSA-test'], max_severity: severity }];
  return report;
}

test('npm passes only a complete successful report below high severity', () => {
  assert.equal(classifyNpm(clean()), 'clean');
  for (const severity of ['high', 'critical']) {
    const r = JSON.parse(clean().stdout);
    r.metadata.vulnerabilities[severity] = 1;
    for (const status of [0, 1]) assert.equal(classifyNpm(result(r, status)), 'blocked');
  }
});

test('only recognized network and temporary audit endpoint errors permit fallback', () => {
  assert.equal(classifyNpm(unavailable()), 'unavailable');
  for (const code of ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH']) {
    assert.equal(
      classifyNpm(result({ error: { code, message: 'network unavailable' } }, 1)),
      'unavailable',
    );
  }
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(
      classifyNpm(
        result(
          {
            error: {
              code: 'ERR_PNPM_AUDIT_BAD_RESPONSE',
              message: `The audit endpoint (at https://registry.npmjs.org/-/npm/v1/security/advisories/bulk) responded with ${status}: unavailable`,
            },
          },
          1,
        ),
      ),
      'unavailable',
    );
  }
});

test('unknown failures, auth/config errors, signals and malformed output stay blocked', () => {
  const bad = [
    { status: 1, stdout: 'timeout 503 Service Unavailable', stderr: '' },
    { ...unavailable(), error: new Error('process timeout') },
    { ...unavailable(), signal: 'SIGTERM' },
    { ...unavailable(), status: 0 },
    result({ error: { code: 'ERR_PNPM_LOCKFILE_MISSING', message: 'missing lockfile' } }, 1),
    result({ error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE', message: 'responded with 503' } }, 1),
    result({ error: { code: 23, message: 'different error' } }, 1),
    result({}),
    result(null),
    result([]),
    { ...clean(), status: 1 },
  ];
  for (const r of bad) assert.equal(classifyNpm(r), 'blocked');
  for (const status of [400, 401, 403, 404, 410]) {
    assert.equal(
      classifyNpm(
        result(
          {
            error: {
              code: 'ERR_PNPM_AUDIT_BAD_RESPONSE',
              message: `The audit endpoint (at https://registry.npmjs.org/-/npm/v1/security/advisories/bulk) responded with ${status}: error`,
            },
          },
          1,
        ),
      ),
      'blocked',
    );
  }
});

test('mixed findings/error reports cannot use a timeout as an escape hatch', () => {
  const error = JSON.parse(unavailable().stdout).error;
  for (const extra of [
    { advisories: {} },
    { vulnerabilities: {} },
    { metadata: { vulnerabilities: { ...counts, critical: 1 } } },
  ]) {
    assert.equal(classifyNpm(result({ error, ...extra }, 1)), 'blocked');
  }
});

test('inventory covers every canonical lockfile package, not just installed/platform packages', () => {
  assert.deepEqual(lockedPackages(lock), expected);
  for (const text of [
    '',
    lock.replace('9.0', '10.0'),
    lock.replace('app-dep@1.0.0:', 'app-dep@git:abc:'),
    "lockfileVersion: '9.0'\npackages:\n",
    lock.replace('snapshots:', '  app-dep@1.0.0:\nsnapshots:'),
  ]) {
    assert.throws(() => lockedPackages(text));
  }
});

test('OSV accepts only complete clean coverage and rejects tool errors or empty scans', () => {
  const path = '/tmp/test-lock.yaml';
  assert.deepEqual(evaluateOsv(result(report(path)), expected, path), {
    packages: 2,
    findings: 0,
    blockers: [],
  });
  for (const status of [1, 2, 127, 128, 130, null])
    assert.throws(() => evaluateOsv(result(report(path), status), expected, path));
  for (const r of [
    result({ results: [] }),
    result({}),
    { status: 0, stdout: 'broken json' },
    { ...result(report(path)), signal: 'SIGKILL' },
  ])
    assert.throws(() => evaluateOsv(r, expected, path));
});

test('OSV package omissions, wrong versions, duplicates and wrong source fail closed', () => {
  const path = '/tmp/test-lock.yaml';
  const mutations = [
    (r) => r.results[0].packages.pop(),
    (r) => r.results[0].packages.push(pkg('extra', '1.0.0')),
    (r) => r.results[0].packages.push(r.results[0].packages[0]),
    (r) => {
      r.results[0].packages[0].package.version = '9.0.0';
    },
    (r) => {
      r.results[0].source.path = '/tmp/wrong.yaml';
    },
    (r) => {
      r.results[0].packages[0].package.ecosystem = 'Go';
    },
    (r) => {
      r.experimental_generic_findings = [{}];
    },
    (r) => {
      r.experimental_generic_findings = {};
    },
    (r) => {
      r.results[0].packages[0].vulnerabilities = null;
    },
    (r) => {
      r.results[0].packages[0].groups = null;
    },
  ];
  for (const mutate of mutations) {
    const r = report(path);
    mutate(r);
    assert.throws(() => evaluateOsv(result(r), expected, path));
  }
});

test('OSV high/critical findings block, including development packages; low/moderate do not', () => {
  const path = '/tmp/test-lock.yaml';
  for (const score of ['7', '7.0', '8.9', '9.0', '10.0']) {
    for (const index of [0, 1])
      assert.equal(
        evaluateOsv(result(finding(report(path), score, index), 1), expected, path).blockers.length,
        1,
      );
  }
  for (const score of ['0', '3.5', '6.9'])
    assert.equal(
      evaluateOsv(result(finding(report(path), score), 1), expected, path).blockers.length,
      0,
    );
});

test('unknown scores, ungrouped findings and inconsistent exit status cannot pass', () => {
  const path = '/tmp/test-lock.yaml';
  for (const score of ['', 'UNKNOWN', 'NaN', '-1', '10.1', '11', null, 7]) {
    assert.throws(() => evaluateOsv(result(finding(report(path), score), 1), expected, path));
  }
  const r = finding(report(path));
  assert.throws(() => evaluateOsv(result(r), expected, path));
  delete r.results[0].packages[0].groups;
  assert.throws(() => evaluateOsv(result(r, 1), expected, path));
});

test('binary checksum mismatch blocks execution', () => {
  assert.throws(() => verifyScanner(Buffer.from('tampered binary'), '0'.repeat(64)), /checksum/);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cinedrive-audit-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const reports = join(root, 'reports');
  mkdirSync(reports);
  writeFileSync(join(root, 'pnpm-lock.yaml'), lock);
  return { root, reports };
}

test('orchestration never installs/runs OSV after npm findings or unknown errors', async (t) => {
  const paths = fixture(t);
  for (const npm of [
    result({ advisories: {}, metadata: { vulnerabilities: { ...counts, high: 1 } } }, 1),
    result({}, 1),
  ]) {
    let calls = 0;
    await assert.rejects(
      runAudit({
        ...paths,
        run: () => {
          calls++;
          return npm;
        },
        scanner: () => {
          throw new Error('must not be called');
        },
      }),
      /no fallback/,
    );
    assert.equal(calls, 1);
  }
  assert.equal(
    (await runAudit({ ...paths, run: clean, scanner: () => assert.fail('must not install') }))
      .provider,
    'npm',
  );
});

test('orchestration permits a complete OSV pass only after a recognized outage', async (t) => {
  const paths = fixture(t);
  let calls = 0;
  const verdict = await runAudit({
    ...paths,
    scanner: async () => '/verified/scanner',
    run: (cmd, args) => {
      calls++;
      if (calls === 1) {
        assert.equal(cmd, 'pnpm');
        assert.ok(args.includes('--prod'));
        return unavailable();
      }
      assert.equal(cmd, '/verified/scanner');
      for (const flag of [
        '--all-packages',
        '--all-vulns',
        '--no-call-analysis=go,rust',
        '--no-resolve',
      ])
        assert.ok(args.includes(flag));
      assert.ok(args.includes(`--config=${join(paths.reports, 'osv-scanner.toml')}`));
      return result(report(join(paths.root, 'pnpm-lock.yaml')));
    },
  });
  assert.equal(verdict.provider, 'osv');
  assert.equal(verdict.packages, 2);
  assert.match(verdict.lockfileSha256, /^[a-f0-9]{64}$/);
  assert.ok(readFileSync(join(paths.reports, 'npm-audit.json'), 'utf8').includes('timeout'));
});

test('OSV download failures and security findings remain failures', async (t) => {
  const paths = fixture(t);
  await assert.rejects(
    runAudit({
      ...paths,
      run: unavailable,
      scanner: async () => {
        throw new Error('download unavailable');
      },
    }),
    /download unavailable/,
  );
  let calls = 0;
  await assert.rejects(
    runAudit({
      ...paths,
      scanner: async () => '/verified/scanner',
      run: () =>
        ++calls === 1
          ? unavailable()
          : result(finding(report(join(paths.root, 'pnpm-lock.yaml'))), 1),
    }),
    /OSV blocking vulnerabilities/,
  );
});
