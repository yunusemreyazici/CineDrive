import { gzipSync } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_ENTRY_BYTES = 380_000;
const MAX_ENTRY_GZIP_BYTES = 110_000;
const webDist = path.join(process.cwd(), 'apps/web/dist');
const html = await readFile(path.join(webDist, 'index.html'), 'utf8');
const entryPath = html.match(/<script\b[^>]*\bsrc="(\/assets\/index-[^"]+\.js)"/)?.[1];

if (!entryPath) {
  throw new Error('Could not find the web entry chunk in apps/web/dist/index.html.');
}

const entryFile = path.join(webDist, entryPath.slice(1));
const [{ size }, contents] = await Promise.all([stat(entryFile), readFile(entryFile)]);
const gzipBytes = gzipSync(contents, { level: 9 }).byteLength;
const formatKilobytes = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

console.log(`Web entry bundle: ${formatKilobytes(size)} raw, ${formatKilobytes(gzipBytes)} gzip`);

if (size > MAX_ENTRY_BYTES || gzipBytes > MAX_ENTRY_GZIP_BYTES) {
  throw new Error(
    `Web entry bundle exceeds its budget (${formatKilobytes(MAX_ENTRY_BYTES)} raw, ` +
      `${formatKilobytes(MAX_ENTRY_GZIP_BYTES)} gzip).`,
  );
}
