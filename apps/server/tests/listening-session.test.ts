import { describe, it, expect } from 'vitest';
import {
  ListeningSessionService,
  type Listener,
} from '../src/services/listening-session.service.js';
const host: Listener = { userId: 'host', clientId: 'mac', name: 'Host' };
const guest: Listener = { userId: 'guest', clientId: 'phone', name: 'Guest' };
const stranger: Listener = { userId: 'other', clientId: 'other', name: 'Other' };

const fixture = async () => {
  let time = 100_000;
  const service = new ListeningSessionService(
    async (_user, ids) => !ids.includes('private'),
    () => time,
  );
  const id = await service.create(host, ['one', 'two'], 0, 10, true);
  const initial = await service.read(id, host);
  await service.join(guest, initial.inviteCode!);
  return {
    service,
    id,
    tick: (ms: number) => {
      time += ms;
    },
  };
};
describe('Listen together synchronization', () => {
  it('waits for both devices and schedules a shared future start', async () => {
    const { service, id, tick } = await fixture();
    const state = await service.read(id, host);
    await service.ready(id, host, state.epoch);
    expect((await service.read(id, host)).playing).toBe(false);
    await service.ready(id, guest, state.epoch);
    const ready = await service.read(id, guest);
    expect(ready.playing).toBe(true);
    expect(ready.startAt - ready.serverTime).toBe(1200);
    expect(ready.position).toBe(10);
    expect(ready.inviteCode).toBeNull();
    tick(3200);
    await service.mutate(id, host, { action: 'pause', revision: ready.revision });
    expect((await service.read(id, host)).position).toBe(12);
  });
  it('allows guest additions, rejects transport controls and third participants', async () => {
    const { service, id } = await fixture();
    let state = await service.read(id, host);
    await expect(service.join(stranger, state.inviteCode!)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(
      service.mutate(id, guest, { action: 'pause', revision: state.revision }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await service.mutate(id, guest, { action: 'add', trackIds: ['one'], revision: state.revision });
    state = await service.read(id, guest);
    expect(state.queue.map((e) => e.trackId)).toEqual(['one', 'two', 'one']);
    expect(new Set(state.queue.map((e) => e.id)).size).toBe(3);
    await expect(service.read(id, stranger)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.read(id, { ...guest, clientId: 'different' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it('never mutates the queue when either account cannot access a track', async () => {
    const { service, id } = await fixture();
    const state = await service.read(id, host);
    await expect(
      service.mutate(id, host, { action: 'add', trackIds: ['private'], revision: state.revision }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect((await service.read(id, host)).queue).toEqual(state.queue);
    await expect(
      service.mutate(id, host, {
        action: 'replace',
        trackIds: ['local-import:one'],
        revision: state.revision,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it('serializes concurrent edits and rejects stale readiness acknowledgements', async () => {
    const { service, id } = await fixture();
    const state = await service.read(id, host);
    const result = await Promise.allSettled([
      service.mutate(id, host, { action: 'seek', position: 45, revision: state.revision }),
      service.mutate(id, guest, { action: 'add', trackIds: ['three'], revision: state.revision }),
    ]);
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((await service.read(id, host)).position).toBe(45);
    await expect(service.ready(id, guest, state.epoch)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('does not pause the remaining listener when the host leaves, and rotates the invite', async () => {
    const { service, id } = await fixture();
    const before = await service.read(id, host);
    await service.ready(id, host, before.epoch);
    await service.ready(id, guest, before.epoch);
    await service.leave(id, host);
    const after = await service.read(id, guest);
    expect(after.hostUserId).toBe(guest.userId);
    expect(after.playing).toBe(true);
    expect(after.inviteCode).not.toBe(before.inviteCode);
    await expect(service.read(id, host)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.join(stranger, before.inviteCode!)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it('keeps current identity when removing earlier queue entries', async () => {
    const { service, id } = await fixture();
    let state = await service.read(id, host);
    await service.mutate(id, host, { action: 'next', revision: state.revision });
    state = await service.read(id, host);
    const current = state.queue[state.index]!.id;
    await service.mutate(id, host, {
      action: 'remove',
      itemId: state.queue[0]!.id,
      revision: state.revision,
    });
    state = await service.read(id, host);
    expect(state.queue[state.index]!.id).toBe(current);
    await expect(
      service.mutate(id, host, { action: 'remove', itemId: current, revision: state.revision }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it('expires abandoned rooms and can close cleanly', async () => {
    const { service, id, tick } = await fixture();
    tick(31 * 60_000);
    await expect(service.read(id, host)).rejects.toMatchObject({ statusCode: 404 });
    const fresh = await service.create(host, ['one'], 0, 0, false);
    service.close();
    await expect(service.read(fresh, host)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('blocks revoked library access during reconnect', async () => {
    let readable = true;
    const service = new ListeningSessionService(async () => readable);
    const id = await service.create(host, ['one'], 0, 0, false);
    readable = false;
    await expect(service.read(id, host)).rejects.toMatchObject({ statusCode: 403 });
  });
});
