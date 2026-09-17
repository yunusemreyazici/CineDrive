import { randomBytes, randomUUID } from 'node:crypto';

export type Listener = { userId: string; clientId: string; name: string };
export type ListenAction = {
  action: 'play' | 'pause' | 'seek' | 'next' | 'previous' | 'replace' | 'add' | 'remove';
  revision: number;
  trackIds?: string[];
  position?: number;
  index?: number;
  itemId?: string;
  playNext?: boolean;
};
type Entry = { id: string; trackId: string };
type Room = {
  id: string;
  code: string;
  hostUserId: string;
  members: Listener[];
  queue: Entry[];
  index: number;
  position: number;
  playing: boolean;
  wantsPlay: boolean;
  startAt: number;
  epoch: number;
  revision: number;
  ready: Set<string>;
  connections: Map<string, number>;
  createdAt: number;
  touchedAt: number;
};
export function listenError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode, code: 'LISTEN_SESSION' });
}
const key = (member: Listener) => `${member.userId}:${member.clientId}`;

/** Live rooms are intentionally ephemeral: restart ends them, reconnect does not. */
export class ListeningSessionService {
  private rooms = new Map<string, Room>();
  private tail: Promise<unknown> = Promise.resolve();
  onChange: (id: string) => void = () => {};
  constructor(
    private canRead: (userId: string, ids: string[]) => Promise<boolean>,
    private now: () => number = Date.now,
  ) {}

  // Serialize validation + mutation, including async permission checks. A stale
  // client never overwrites a simultaneous edit from the other participant.
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  private requireRoom(id: string, member: Listener): Room {
    this.sweep();
    const room = this.rooms.get(id);
    if (!room || !room.members.some((m) => key(m) === key(member))) {
      throw listenError(404, 'Dinleme oturumu bulunamadı veya sona erdi.');
    }
    return room;
  }
  private position(room: Room) {
    return room.position + (room.playing ? Math.max(0, this.now() - room.startAt) / 1000 : 0);
  }
  private prepare(room: Room, playing: boolean, position = this.position(room)) {
    room.position = position;
    room.playing = false;
    room.wantsPlay = playing;
    room.startAt = this.now();
    room.epoch++;
    room.ready.clear();
  }
  private changed(room: Room) {
    room.revision++;
    room.touchedAt = this.now();
    this.onChange(room.id);
  }
  private async checkTracks(members: Listener[], ids: string[]) {
    if (!ids.length || ids.length > 250 || ids.some((id) => id.startsWith('local-import:'))) {
      throw listenError(400, 'Oturum kuyruğu 1–250 sunucu parçası içermeli.');
    }
    for (const m of members) {
      if (!(await this.canRead(m.userId, [...new Set(ids)]))) {
        throw listenError(403, 'Her iki katılımcının da bu parçalara kütüphane erişimi olmalı.');
      }
    }
  }
  private ensureFree(member: Listener) {
    if ([...this.rooms.values()].some((r) => r.members.some((m) => m.userId === member.userId))) {
      throw listenError(409, 'Önce mevcut birlikte dinleme oturumundan ayrıl.');
    }
  }
  create(member: Listener, ids: string[], index: number, position: number, playing: boolean) {
    return this.serial(async () => {
      this.sweep();
      this.ensureFree(member);
      if (this.rooms.size >= 500)
        throw listenError(503, 'Dinleme oturumları dolu. Daha sonra tekrar dene.');
      await this.checkTracks([member], ids);
      const room: Room = {
        id: randomUUID(),
        code: randomBytes(8).toString('hex').toUpperCase(),
        hostUserId: member.userId,
        members: [member],
        queue: ids.map((trackId) => ({ id: randomUUID(), trackId })),
        index: Math.max(0, Math.min(index, ids.length - 1)),
        position,
        playing: false,
        wantsPlay: playing,
        startAt: this.now(),
        epoch: 1,
        revision: 1,
        ready: new Set(),
        connections: new Map(),
        createdAt: this.now(),
        touchedAt: this.now(),
      };
      this.rooms.set(room.id, room);
      return room.id;
    });
  }
  join(member: Listener, code: string) {
    return this.serial(async () => {
      this.sweep();
      const room = [...this.rooms.values()].find((r) => r.code === code);
      if (!room) throw listenError(404, 'Davet geçersiz veya süresi dolmuş.');
      if (room.members.some((m) => key(m) === key(member))) return room.id;
      this.ensureFree(member);
      if (room.members.length >= 2)
        throw listenError(409, 'Bu oturum iki kişilik ve şu anda dolu.');
      await this.checkTracks(
        [...room.members, member],
        room.queue.map((e) => e.trackId),
      );
      this.prepare(room, room.playing || room.wantsPlay);
      room.members.push(member);
      this.changed(room);
      return room.id;
    });
  }
  async read(id: string, member: Listener) {
    const room = this.requireRoom(id, member);
    // Revalidate membership access after library permissions or files change.
    await this.checkTracks(
      [member],
      room.queue.map((e) => e.trackId),
    );
    if (this.rooms.get(id) !== room || !room.members.some((m) => key(m) === key(member))) {
      throw listenError(404, 'Dinleme oturumu sona erdi.');
    }
    room.touchedAt = this.now();
    return {
      id: room.id,
      revision: room.revision,
      epoch: room.epoch,
      hostUserId: room.hostUserId,
      members: room.members.map((m) => ({
        ...m,
        ready: room.ready.has(key(m)),
        online: (room.connections.get(key(m)) ?? 0) > 0,
      })),
      queue: room.queue.map((entry) => ({ ...entry })),
      index: room.index,
      position: room.position,
      playing: room.playing,
      preparing: room.wantsPlay && !room.playing,
      startAt: room.startAt,
      serverTime: this.now(),
      // Only the host can obtain/share the invitation.
      inviteCode: room.hostUserId === member.userId ? room.code : null,
    };
  }
  ready(id: string, member: Listener, epoch: number) {
    return this.serial(async () => {
      const room = this.requireRoom(id, member);
      if (room.epoch !== epoch) throw listenError(409, 'Oynatma durumu değişti. Yeniden eşitle.');
      if (room.ready.has(key(member))) return;
      room.ready.add(key(member));
      if (room.wantsPlay && room.members.every((m) => room.ready.has(key(m)))) {
        room.playing = true;
        room.wantsPlay = false;
        room.startAt = this.now() + 1200;
      }
      this.changed(room);
    });
  }
  mutate(id: string, member: Listener, input: ListenAction) {
    return this.serial(async () => {
      const room = this.requireRoom(id, member);
      if (room.revision !== input.revision)
        throw listenError(409, 'Kuyruk değişti. Güncel durumla tekrar dene.');
      if (member.userId !== room.hostUserId && input.action !== 'add') {
        throw listenError(
          403,
          'Oynatmayı oturum sahibi yönetir. Sen kuyruğa parça ekleyebilirsin.',
        );
      }
      switch (input.action) {
        case 'add': {
          const ids = input.trackIds ?? [];
          await this.checkTracks(room.members, [...room.queue.map((e) => e.trackId), ...ids]);
          room.queue.splice(
            input.playNext ? room.index + 1 : room.queue.length,
            0,
            ...ids.map((trackId) => ({ id: randomUUID(), trackId })),
          );
          break;
        }
        case 'replace': {
          const ids = input.trackIds ?? [];
          await this.checkTracks(room.members, ids);
          room.queue = ids.map((trackId) => ({ id: randomUUID(), trackId }));
          room.index = Math.max(0, Math.min(input.index ?? 0, ids.length - 1));
          this.prepare(room, true, input.position ?? 0);
          break;
        }
        case 'remove': {
          const index = room.queue.findIndex((e) => e.id === input.itemId);
          if (index < 0 || index === room.index)
            throw listenError(400, 'Çalan parça kaldırılamaz.');
          room.queue.splice(index, 1);
          if (index < room.index) room.index--;
          break;
        }
        case 'play':
          this.prepare(room, true);
          break;
        case 'pause':
          this.prepare(room, false);
          break;
        case 'seek':
          this.prepare(room, room.playing || room.wantsPlay, input.position ?? 0);
          break;
        case 'next':
          if (room.index + 1 < room.queue.length) {
            room.index++;
            this.prepare(room, true, 0);
          } else this.prepare(room, false);
          break;
        case 'previous':
          if (this.position(room) < 3) room.index = Math.max(0, room.index - 1);
          this.prepare(room, true, 0);
          break;
      }
      this.changed(room);
    });
  }
  leave(id: string, member: Listener) {
    return this.serial(async () => {
      const room = this.requireRoom(id, member);
      room.members = room.members.filter((m) => key(m) !== key(member));
      if (!room.members.length) {
        this.rooms.delete(id);
        this.onChange(id);
        return;
      }
      if (room.hostUserId === member.userId) room.hostUserId = room.members[0]!.userId;
      // Leaving never pauses the remaining participant. A pending preparation
      // starts once the remaining participant has acknowledged it.
      if (room.wantsPlay && room.members.every((m) => room.ready.has(key(m)))) {
        room.playing = true;
        room.wantsPlay = false;
        room.startAt = this.now() + 1200;
      }
      room.code = randomBytes(8).toString('hex').toUpperCase();
      this.changed(room);
    });
  }
  connectionChanged(id: string, member: Listener, connected: boolean) {
    const room = this.rooms.get(id);
    if (!room || !room.members.some((m) => key(m) === key(member))) return;
    const count = Math.max(0, (room.connections.get(key(member)) ?? 0) + (connected ? 1 : -1));
    room.connections.set(key(member), count);
    this.onChange(id);
  }
  sweep() {
    for (const [id, room] of this.rooms) {
      if (
        this.now() - room.touchedAt > 30 * 60_000 ||
        this.now() - room.createdAt > 6 * 60 * 60_000
      ) {
        this.rooms.delete(id);
        this.onChange(id);
      }
    }
  }
  close() {
    this.rooms.clear();
  }
}
