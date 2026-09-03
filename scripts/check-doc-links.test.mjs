import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkDocumentation } from './check-doc-links.mjs';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'cinedrive-docs-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

test('checks Markdown, HTML, images, and relative guide links', (t) => {
  const root = fixture(t, {
    'README.md':
      '<h1>CineDrive</h1>\n[Top](#cinedrive)\n[Guide](docs/guide.md#setup)\n<img src="docs/image.svg" />',
    'docs/guide.md':
      '# Setup\n![Image](image.svg)\n[Home](../README.md)\n<a href="../LICENSE">License</a>',
    'docs/image.svg': '<svg/>',
    LICENSE: 'MIT',
  });
  assert.deepEqual(checkDocumentation(root), { files: 2, checked: 6, errors: [] });
});

test('reports missing files and anchors with original line numbers', (t) => {
  const result = checkDocumentation(
    fixture(t, {
      'README.md': '# Intro\n\n[Missing](absent.md)\n[Wrong](#absent)',
    }),
  );
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /README.md:3: missing file/);
  assert.match(result.errors[1], /README.md:4: missing heading/);
});

test('supports Turkish headings, encoded paths, duplicate headings and explicit IDs', (t) => {
  const result = checkDocumentation(
    fixture(t, {
      'README.md':
        '[Guide](docs/a%20b.md#dockerda-yerel-medya)\n[A](docs/a%20b.md#%C3%B6zellikler)\n[B](docs/a%20b.md#repeat-1)\n[C](docs/a%20b.md#custom)',
      'docs/a b.md':
        '# Docker\'da yerel medya\n## Özellikler\n## Repeat\n## Repeat\n<a id="custom"></a>',
    }),
  );
  assert.deepEqual(result.errors, []);
});

test('ignores fenced examples, inline code, comments and external URLs', (t) => {
  const result = checkDocumentation(
    fixture(t, {
      'README.md':
        '```md\n[bad](no.md)\n```\n~~~\n[bad](no.md)\n~~~\n`[bad](no.md)`\n<!-- [bad](no.md) -->\n[Web](https://example.test)\n<a href="mailto:a@example.test">Mail</a>\n![CDN](//example.test/img.png)',
    }),
  );
  assert.deepEqual(result, { files: 1, checked: 0, errors: [] });
});

test('validates explicit and collapsed references including undefined ones', (t) => {
  const result = checkDocumentation(
    fixture(t, {
      'README.md': '[Guide][guide]\n[guide][]\n[Bad][missing]\n[guide]: docs/guide.md "Guide"',
      'docs/guide.md': '# Guide',
    }),
  );
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /README.md:3: undefined reference: missing/);
});

test('handles angle destinations, titles, and parenthesized paths', (t) => {
  const result = checkDocumentation(
    fixture(t, {
      'README.md': '[A](<docs/a b.md> "A")\n[B](docs/a(b).md)',
      'docs/a b.md': '# A',
      'docs/a(b).md': '# B',
    }),
  );
  assert.equal(result.checked, 2);
  assert.deepEqual(result.errors, []);
});

test('rejects repository escapes and malformed URL encoding', (t) => {
  const result = checkDocumentation(
    fixture(t, {
      'README.md': '[Outside](../outside.md)\n[Invalid](%zz.md)',
    }),
  );
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /outside repository/);
  assert.match(result.errors[1], /invalid URL encoding/);
});

test('CLI fails for broken docs and succeeds for valid docs', (t) => {
  const script = fileURLToPath(new URL('./check-doc-links.mjs', import.meta.url));
  for (const [text, status] of [
    ['[Broken](no.md)', 1],
    ['# Valid', 0],
  ]) {
    const result = spawnSync(process.execPath, [script], {
      cwd: fixture(t, { 'README.md': text }),
      encoding: 'utf8',
    });
    assert.equal(result.status, status, result.stderr);
    assert.match(status ? result.stderr : result.stdout, status ? /missing file/ : /links OK/);
  }
});
