import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const helpers = new URL('./install-vps-lib.sh', import.meta.url).pathname;
const installerUrl = new URL('./install-vps.sh', import.meta.url);
const installer = readFileSync(installerUrl, 'utf8');

const validates = (functionName, value) => {
  try {
    execFileSync('bash', ['-c', 'source "$1"; "$2" "$3"', 'installer-test', helpers, functionName, value], {
      stdio: 'pipe',
    });
    return true;
  } catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
};

test('domain validation accepts hostnames and rejects Nginx injection', () => {
  for (const domain of ['media.example.com', 'xn--rnek-2qa.example', 'a-b.example.co.uk']) {
    assert.equal(validates('validate_domain', domain), true, domain);
  }

  for (const domain of [
    'localhost',
    '127.0.0.1',
    '-media.example.com',
    'media.example.com; include /tmp/evil',
    'media.example.com\nserver {',
  ]) {
    assert.equal(validates('validate_domain', domain), false, domain);
  }
});

test('certificate path validation only accepts safe absolute paths', () => {
  for (const path of ['/etc/ssl/cloudflare/cinedrive.pem', '/etc/letsencrypt/live/a-b.example/fullchain.pem']) {
    assert.equal(validates('validate_nginx_path', path), true, path);
  }

  for (const path of ['relative.pem', '/etc/ssl/my cert.pem', '/etc/ssl/a.pem; include /tmp/evil', '/etc/../root/key']) {
    assert.equal(validates('validate_nginx_path', path), false, path);
  }
});

test('email and pinned pnpm version validation reject malformed input', () => {
  assert.equal(validates('validate_email', 'admin@example.com'), true);
  assert.equal(validates('validate_email', 'admin example.com'), false);
  assert.equal(validates('validate_email', 'admin@example'), false);
  assert.equal(validates('validate_pnpm_version', '11.22.0'), true);
  assert.equal(validates('validate_pnpm_version', 'latest'), false);
});

test('Google Drive choice accepts non-interactive boolean values', () => {
  for (const [input, expected] of [
    ['yes', 'true'],
    ['true', 'true'],
    ['1', 'true'],
    ['no', 'false'],
    ['false', 'false'],
    ['0', 'false'],
  ]) {
    const output = execFileSync(
      'bash',
      [
        '-c',
        'source "$1"; USE_GOOGLE_DRIVE="$2"; prompt_yes_no USE_GOOGLE_DRIVE ignored no; printf %s "$USE_GOOGLE_DRIVE"',
        'installer-test',
        helpers,
        input,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(output, expected, input);
  }
});

test('installer keeps update and local-only safety guards wired in', () => {
  assert.match(installer, /CINEDRIVE_INSTALLER_REEXEC/);
  assert.match(installer, /mktemp -d \/tmp\/cinedrive-installer/);
  assert.match(installer, /flock --nonblock 9/);
  assert.match(installer, /status --porcelain --untracked-files=no/);
  assert.match(installer, /merge-base --is-ancestor/);
  assert.match(installer, /USE_GOOGLE_DRIVE/);
  assert.match(installer, /local-only\.apps\.googleusercontent\.com/);
  assert.match(installer, /Güncelleme kurtarma bilgisi/);
  assert.match(installer, /Database backup created:/);
  assert.match(installer, /CERT_PUBLIC_KEY.*KEY_PUBLIC_KEY/s);
  assert.match(installer, /Yarım kalmış veya tutarsız bir CineDrive kurulumu/);

  const updateBlock = installer.slice(installer.indexOf('if [[ -d "$APP_DIR/.git" ]]'));
  assert.ok(
    updateBlock.indexOf('create_database_backup_if_present') <
      updateBlock.indexOf('merge --ff-only'),
    'the verified database snapshot must precede source mutation',
  );
});
