import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';

const now = '2026-11-06T12:00:00.000Z';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

it('creates no dedicated music storage and keeps ordinary music dialogue across reopen', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-without-music-'));
  directories.push(directory);
  const file = path.join(directory, 'memory.db');
  let store = SqliteMemoryStore.open(file, now);
  const run = (operation: string, payload: unknown) => store.execute({ id: 1, generation: 0, operation, payload });
  try {
    const db = new Database(file);
    try {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'music_%'").all()).toEqual([]);
      const columns = db.prepare('PRAGMA table_info(messages)').all();
      expect(JSON.stringify(columns)).not.toContain('music_');
    } finally { db.close(); }
    for (const operation of ['readMusicInterest', 'appendMusicSample', 'replaceMusicPreference']) {
      expect(run(operation, null)).toEqual({ ok: false, code: 'invalid_data' });
    }
    const session = { id: 'session', appRunId: 'app', startedAt: now, endedAt: null };
    const message = { conversationSessionId: session.id, createdAt: now };
    const user = { ...message, id: 'user', role: 'user', content: 'Давай обсудим метал, джаз и музыку к фильмам.' };
    const assistant = { ...message, id: 'assistant', role: 'assistant', content: 'С какого произведения начнём?' };
    expect(run('appendTurn', { session, user, assistant })).toEqual({ ok: true, value: undefined });
    store.close();
    store = SqliteMemoryStore.open(file, now);
    expect(run('getRecent', 20)).toEqual({ ok: true, value: [user, assistant] });
  } finally { store.close(); }
});
