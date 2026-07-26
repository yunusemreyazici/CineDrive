import crypto from 'node:crypto';

/**
 * FFmpeg receives its Google Drive input as a URL. Embedding
 * `Authorization: Bearer <token>` in the process arguments froze a ~1 hour
 * access token into a job that can outlive it, and exposed the token through
 * `/proc/<pid>/cmdline` and `ps`.
 *
 * Instead FFmpeg is pointed at a loopback-only route on this server. Each
 * (re)connection resolves a fresh access token server-side, so long encodes no
 * longer die mid-file and no Google credential ever reaches an argument list.
 */

// Long enough to outlast a full-length feature transcode, short enough that a
// leaked URL is not a durable capability.
const CAPABILITY_TTL_MS = 12 * 60 * 60 * 1000;

export type DriveSourceCapability = {
  googleDriveFileId: string;
  userId: string;
  connectionId?: string;
};

type CapabilityPayload = {
  f: string;
  u: string;
  c: string;
  e: number;
};

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export class DriveSourceService {
  private readonly signingKey: Buffer;

  constructor(secret: string) {
    // Domain-separated from any other use of SESSION_SECRET so a capability can
    // never be confused with a cookie signature or vice versa.
    this.signingKey = crypto.createHmac('sha256', secret).update('drive-source-v1').digest();
  }

  public issue(capability: DriveSourceCapability, now = Date.now()): string {
    const payload: CapabilityPayload = {
      f: capability.googleDriveFileId,
      u: capability.userId,
      c: capability.connectionId || '',
      e: now + CAPABILITY_TTL_MS,
    };
    const encoded = base64url(JSON.stringify(payload));
    return `${encoded}.${this.sign(encoded)}`;
  }

  public verify(token: string, now = Date.now()): DriveSourceCapability | null {
    if (typeof token !== 'string' || token.length > 4096) return null;

    const separator = token.lastIndexOf('.');
    if (separator <= 0) return null;

    const encoded = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!this.verifySignature(encoded, signature)) return null;

    let payload: CapabilityPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as CapabilityPayload;
    } catch {
      return null;
    }

    if (
      typeof payload?.f !== 'string' ||
      typeof payload?.u !== 'string' ||
      typeof payload?.e !== 'number' ||
      !payload.f ||
      !payload.u
    ) {
      return null;
    }
    if (payload.e <= now) return null;

    return {
      googleDriveFileId: payload.f,
      userId: payload.u,
      ...(payload.c ? { connectionId: payload.c } : {}),
    };
  }

  private sign(encoded: string) {
    return crypto.createHmac('sha256', this.signingKey).update(encoded).digest('base64url');
  }

  private verifySignature(encoded: string, signature: string) {
    const expected = Buffer.from(this.sign(encoded));
    const provided = Buffer.from(signature);
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  }
}

/**
 * Only FFmpeg processes started by this server may use a capability. In Docker
 * the reverse proxy connects from the bridge network, so a loopback peer check
 * keeps the route unreachable from outside the container.
 */
export const isLoopbackAddress = (address: string | undefined) => {
  if (!address) return false;
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  return normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('127.');
};
