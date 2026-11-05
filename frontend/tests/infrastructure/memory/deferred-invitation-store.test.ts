import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { CAUSAL_LIFE_SCHEMA } from '../../../src/infrastructure/memory/causal-life-store';
import { DEFERRED_INVITATION_SCHEMA, DeferredInvitationStore } from '../../../src/infrastructure/memory/deferred-invitation-store';
import { invitationWindow } from '../../../src/domain/behavior/deferred-game-invitation';
import type { CausalLifeEpisode, DeferredGameInvitation } from '../../../src/application/ports/causal-life.interface';
const now = '2026-11-05T10:00:00.000Z';
const ready = '2026-11-05T10:05:00.000Z';
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new Database(':memory:'); databases.push(db); db.pragma('foreign_keys=ON'); db.exec(CAUSAL_LIFE_SCHEMA + DEFERRED_INVITATION_SCHEMA);
  return { db, store: new DeferredInvitationStore(db) };
}
function source(db: Database.Database, sequence = 1, override: Partial<CausalLifeEpisode> = {}): void {
  const value: CausalLifeEpisode = { appRunId: 'app',sequence,revision: 1,occurredAt: now,source: 'autonomy',triggerSequence: null,
    activityRunId: 'game-'+sequence,activity: 'cursor_game',outcome: 'completed',terminalReason: null,cause: 'completed',executedMs: 2000,participation: 'user_engaged',...override };
  db.prepare('INSERT INTO causal_life_episodes VALUES (?,?,?,?)').run(value.appRunId,value.sequence,value.activityRunId,JSON.stringify(value));
}
function invite(sequence = 1): DeferredGameInvitation { return { id: 'invite-'+sequence,sourceAppRunId: 'app',sourceSequence: sequence,createdAt: now,...invitationWindow(now),state: 'pending' }; }
it('claims once at the exact boundary and preserves consumed sources after replacing a terminal row', () => {
  const { db,store } = fixture(); source(db); source(db,2); source(db,3);
  store.create(invite()); store.create(invite());
  expect(store.claim({id: 'invite-1',now})).toBe(false);
  expect(store.claim({id: 'invite-1',now: ready})).toBe(true);
  expect(store.claim({id: 'invite-1',now: ready})).toBe(false);
  store.create(invite(2)); // Busy sources are consumed, never queued for later replay.
  store.finish({id: 'invite-1',state: 'completed'});
  store.create(invite(3)); expect(store.read(ready)?.id).toBe('invite-3');
  store.finish({id: 'invite-3',state: 'cancelled'}); store.create(invite(2)); store.create({...invite(),id:'replay'});
  expect(store.read(ready)).toMatchObject({id:'invite-3',state:'cancelled'});
});
it('recovers pending without starting and abandons a process-lost claim', () => {
  const { db,store } = fixture(); source(db); store.create(invite());
  expect(new DeferredInvitationStore(db).read(ready)?.state).toBe('pending');
  expect(store.claim({id:'invite-1',now:ready})).toBe(true);
  expect(new DeferredInvitationStore(db).read(ready)?.state).toBe('abandoned');
  expect(store.claim({id:'invite-1',now:ready})).toBe(false);
});
it('expires and cancels backwards wall clocks using persisted lastSeenWall', () => {
  const {db,store}=fixture(); source(db); store.create(invite());
  store.read('2026-11-05T10:04:00.000Z'); expect(store.read('2026-11-05T10:03:59.999Z')?.state).toBe('cancelled');
  source(db,2); store.create(invite(2)); expect(store.read('2026-11-06T10:00:00.000Z')?.state).toBe('expired');
});
it('validates source/payload and keeps the singleton atomic on invalid requests', () => {
  const {db,store}=fixture(); source(db); source(db,2,{participation:'solitary'});
  expect(()=>store.create(invite(2))).toThrow();
  expect(()=>store.create({...invite(),notBefore:now})).toThrow();
  expect(()=>store.create({...invite(),extra:'private'})).toThrow();
  store.create(invite()); expect(()=>store.finish({id:'invite-1',state:'completed'})).toThrow();
  expect(store.read(now)?.state).toBe('pending');
  db.prepare('DELETE FROM causal_life_episodes WHERE sequence=1').run();
  expect(store.read(now)).toBe(null);
  store.clear(); expect(db.prepare('SELECT count(*) n FROM deferred_invitation_sources').get()).toEqual({n:0});
});
