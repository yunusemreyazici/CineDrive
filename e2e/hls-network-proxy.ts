import http from 'node:http';
import { E2E_BASE_URL, E2E_HLS_FILE_ID } from './env.js';

/** Test-only transport fault injection, including WebKit's native media stack.
 * No production hooks, browser media mocks or network-facing control endpoint.
 */
export const startHlsNetworkProxy = async () => {
  let outage = false;
  let failNextSegment = false;
  let failures = 0;
  let successfulSegments = 0;
  const upstreamOrigin = new URL(E2E_BASE_URL);
  const server = http.createServer((request, response) => {
    const requestTarget = request.url || '/';
    // HTTP clients may send an absolute-form request target to a proxy. Never
    // allow that input to replace the fixed local E2E upstream origin.
    if (!requestTarget.startsWith('/') || requestTarget.startsWith('//')) {
      response.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Invalid request target');
      return;
    }
    const requestedUrl = new URL(requestTarget, 'http://local.invalid');
    const path = requestedUrl.pathname;
    const isAsset =
      path.startsWith(`/api/media/${E2E_HLS_FILE_ID}/hls/`) && /\.(m3u8|m4s|mp4)$/.test(path);
    const isSegment = isAsset && path.endsWith('.m4s');
    if (isAsset && (outage || (isSegment && failNextSegment))) {
      if (isSegment) failNextSegment = false;
      failures += 1;
      response.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Temporary HLS transport failure (isolated E2E fixture)');
      return;
    }
    const upstream = http.request(
      {
        protocol: upstreamOrigin.protocol,
        hostname: upstreamOrigin.hostname,
        port: upstreamOrigin.port,
        path: `${requestedUrl.pathname}${requestedUrl.search}`,
        method: request.method,
        headers: { ...request.headers, host: upstreamOrigin.host },
      },
      (incoming) => {
        if (isSegment && incoming.statusCode === 200) successfulSegments += 1;
        response.writeHead(incoming.statusCode || 502, incoming.headers);
        incoming.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test proxy address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    setOutage(value: boolean) {
      outage = value;
    },
    failNextSegment() {
      failNextSegment = true;
    },
    stats: () => ({ failures, successfulSegments }),
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
};
