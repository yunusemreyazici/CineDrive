import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
// Structural assertions for this workflow's two-space job layout, not a YAML
// parser. Execute the actual gate command below so its logic is not duplicated.
const jobHeaders = [...workflow.matchAll(/^  ([\w-]+):\n/gm)];
const jobs = new Map(
  jobHeaders.map((match, index) => [
    match[1],
    workflow.slice(match.index, jobHeaders[index + 1]?.index ?? workflow.length),
  ]),
);

test('audit is independent, bounded, and fail-closed', () => {
  const audit = jobs.get('audit');
  assert.ok(audit, 'a separate audit job must exist');
  assert.doesNotMatch(audit, /^    (?:needs|if|continue-on-error):/m);
  assert.match(audit, /^    timeout-minutes: 15$/m);
  assert.match(audit, /run: pnpm install --frozen-lockfile\n/);
  assert.match(audit, /timeout-minutes: 10\n        run: pnpm audit:ci\n/);
  assert.match(audit, /if: always\(\) && steps.audit.outputs.report_dir != ''/);
  assert.match(audit, /name: dependency-audit-reports/);
  assert.doesNotMatch(audit, /ignore-registry-errors|continue-on-error|\|\|\s*true/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['audit:prod'], 'pnpm audit --prod --audit-level high');
  assert.equal(pkg.scripts['audit:ci'], 'node scripts/audit-dependencies.mjs');
  assert.ok(pkg.scripts['ci:test'].includes('scripts/audit-dependencies.test.mjs'));
});

test('verification, browser tests, and Docker smoke do not wait for audit', () => {
  const verify = jobs.get('verify');
  assert.ok(verify);
  assert.doesNotMatch(verify, /^    needs:|pnpm audit/m);
  assert.match(verify, /run: pnpm ci:test/);
  for (const job of ['docker-smoke', 'e2e-browsers']) {
    assert.match(jobs.get(job), /^    needs: verify$/m);
  }
});

test('existing required e2e check includes audit and always evaluates upstream results', () => {
  const gate = jobs.get('e2e');
  assert.ok(gate, 'preserve the ruleset-required e2e check name');
  assert.match(gate, /^    if: always\(\)$/m);
  assert.match(gate, /^    needs: \[verify, e2e-browsers, audit\]$/m);
  assert.doesNotMatch(gate, /continue-on-error/);
  for (const [name, job] of [
    ['VERIFY', 'verify'],
    ['BROWSERS', 'e2e-browsers'],
    ['AUDIT', 'audit'],
  ]) {
    assert.ok(gate.includes(`${name}_RESULT: \${{ needs.${job}.result }}`));
  }
});

test('gate only passes when all three upstream results succeed (125 combinations)', () => {
  const gate = jobs.get('e2e');
  const command = gate.match(/^        run: \|\n((?:          .*(?:\n|$))+)/m)?.[1];
  assert.ok(command, 'expected a multiline gate command');
  const states = ['success', 'failure', 'cancelled', 'skipped', ''];
  for (const verify of states)
    for (const browsers of states)
      for (const audit of states) {
        const result = spawnSync('bash', ['-e', '-c', command], {
          env: {
            ...process.env,
            VERIFY_RESULT: verify,
            BROWSERS_RESULT: browsers,
            AUDIT_RESULT: audit,
          },
          encoding: 'utf8',
        });
        assert.ifError(result.error);
        assert.equal(
          result.status === 0,
          [verify, browsers, audit].every((s) => s === 'success'),
          `verify=${verify}, browsers=${browsers}, audit=${audit}: ${result.stderr}`,
        );
      }
});
