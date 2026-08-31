import { spawn } from 'node:child_process';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build, context } from 'esbuild';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDirectory = path.join(packageRoot, 'dist');
const watch = process.argv.includes('--watch');
const tscPath = require.resolve('typescript/bin/tsc');

const builds = [
  { format: 'cjs', outfile: path.join(distDirectory, 'index.js') },
  { format: 'esm', outfile: path.join(distDirectory, 'index.mjs') },
].map((output) => ({
  entryPoints: [path.join(packageRoot, 'src/index.ts')],
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'es2022',
  logLevel: 'info',
  ...output,
}));

const runTypeScript = (extraArguments = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        tscPath,
        '--project',
        path.join(packageRoot, 'tsconfig.json'),
        '--emitDeclarationOnly',
        ...extraArguments,
      ],
      { cwd: packageRoot, stdio: 'inherit' },
    );

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(child);
      else reject(new Error(`Type declaration build failed (${signal ?? `exit ${code}`}).`));
    });
  });

const verifyRuntimeExports = async () => {
  const esm = await import(pathToFileURL(path.join(distDirectory, 'index.mjs')).href);
  const cjs = require(path.join(distDirectory, 'index.js'));
  const esmExports = Object.keys(esm).sort();
  const cjsExports = Object.keys(cjs).sort();

  if (JSON.stringify(esmExports) !== JSON.stringify(cjsExports)) {
    throw new Error('CJS and ESM builds expose different runtime exports.');
  }

  for (const expected of ['envSchema', 'loginSchema', 'parseMediaFilename']) {
    if (!esmExports.includes(expected)) {
      throw new Error(`Shared build is missing the ${expected} runtime export.`);
    }
  }
};

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });

if (!watch) {
  await Promise.all(builds.map((options) => build(options)));
  await runTypeScript();
  // Preserve the declaration artifact produced by the previous build system.
  await copyFile(path.join(distDirectory, 'index.d.ts'), path.join(distDirectory, 'index.d.mts'));
  await verifyRuntimeExports();
  process.exit(0);
}

await Promise.all(
  builds.map(async (options) => {
    const buildContext = await context(options);
    await buildContext.watch();
  }),
);
await runTypeScript(['--watch', '--preserveWatchOutput']);
