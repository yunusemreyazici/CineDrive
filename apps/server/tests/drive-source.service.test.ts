import { describe, expect, it } from 'vitest';
import { DriveSourceService, isLoopbackAddress } from '../src/services/drive-source.service';

const service = new DriveSourceService('a'.repeat(64));
const foreignService = new DriveSourceService('b'.repeat(64));

const capability = {
  googleDriveFileId: 'gdrive-file-abc',
  userId: 'user-1',
  connectionId: 'connection-9',
};

describe('DriveSourceService', () => {
  it('round trips a capability', () => {
    expect(service.verify(service.issue(capability))).toEqual(capability);
  });

  it('omits an absent connection id instead of returning an empty string', () => {
    const token = service.issue({ googleDriveFileId: 'file', userId: 'user-1' });
    expect(service.verify(token)).toEqual({ googleDriveFileId: 'file', userId: 'user-1' });
  });

  it('rejects a capability signed with a different secret', () => {
    expect(foreignService.verify(service.issue(capability))).toBeNull();
  });

  it('rejects a payload swapped onto a valid signature', () => {
    const token = service.issue(capability);
    const signature = token.slice(token.lastIndexOf('.') + 1);
    const forged = Buffer.from(
      JSON.stringify({ f: 'someone-elses-file', u: 'user-1', c: '', e: Date.now() + 60_000 }),
    ).toString('base64url');

    expect(service.verify(`${forged}.${signature}`)).toBeNull();
  });

  it('rejects truncated and malformed tokens without throwing', () => {
    const token = service.issue(capability);
    expect(service.verify(token.slice(0, -4))).toBeNull();
    for (const malformed of ['', '.', 'abc', 'a.b', '....']) {
      expect(service.verify(malformed)).toBeNull();
    }
  });

  it('expires a capability after its time to live', () => {
    const issuedAt = Date.now() - 13 * 60 * 60 * 1000;
    expect(service.verify(service.issue(capability, issuedAt))).toBeNull();
  });

  it('still accepts a capability inside its time to live', () => {
    const issuedAt = Date.now() - 11 * 60 * 60 * 1000;
    expect(service.verify(service.issue(capability, issuedAt))).toEqual(capability);
  });

  it('never embeds a Google credential in the token', () => {
    expect(service.issue(capability).toLowerCase()).not.toContain('bearer');
  });
});

describe('isLoopbackAddress', () => {
  it('accepts loopback peers', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.53']) {
      expect(isLoopbackAddress(address)).toBe(true);
    }
  });

  it('rejects container and LAN peers, so the proxy stays unreachable via nginx', () => {
    for (const address of ['172.18.0.5', '10.0.0.1', '192.168.1.4', '::ffff:172.18.0.5', '']) {
      expect(isLoopbackAddress(address)).toBe(false);
    }
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
