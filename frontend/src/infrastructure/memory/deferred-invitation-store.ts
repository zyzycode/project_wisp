import type Database from 'better-sqlite3';
import { invitationSourceEligible, invitationTimeState } from '../../domain/behavior/deferred-game-invitation';
import { causalEpisode } from './causal-life-validation';
import { deferredInvitation, deferredTerminal } from './deferred-invitation-validation';
import { MemoryDataError, record, text, timestamp } from './validation-primitives';
import type { DeferredGameInvitation } from '../../application/ports/causal-life.interface';
export const DEFERRED_INVITATION_SCHEMA = `
CREATE TABLE deferred_invitation_sources (app_run_id TEXT NOT NULL, sequence INTEGER NOT NULL, invitation_id TEXT NOT NULL UNIQUE, PRIMARY KEY(app_run_id,sequence), FOREIGN KEY(app_run_id,sequence) REFERENCES causal_life_episodes(app_run_id,sequence) ON DELETE CASCADE);
CREATE TABLE deferred_game_invitation (singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload TEXT NOT NULL, last_seen_wall TEXT NOT NULL, source_app_run_id TEXT NOT NULL, source_sequence INTEGER NOT NULL, FOREIGN KEY(source_app_run_id,source_sequence) REFERENCES causal_life_episodes(app_run_id,sequence) ON DELETE CASCADE);
`;
export class DeferredInvitationStore {
  constructor(private readonly db: Database.Database) {}
  create(value: unknown): void {
    const invite = deferredInvitation(value);
    if (invite.state !== 'pending') throw new MemoryDataError('invalid_data');
    this.db.transaction(() => {
      this.validateSource(invite);
      const usedId = this.db.prepare('SELECT app_run_id,sequence FROM deferred_invitation_sources WHERE invitation_id=?').get(invite.id);
      if (usedId && (record(usedId).app_run_id !== invite.sourceAppRunId || record(usedId).sequence !== invite.sourceSequence)) throw new MemoryDataError('conflict');
      if (this.db.prepare('SELECT 1 FROM deferred_invitation_sources WHERE app_run_id=? AND sequence=?').get(invite.sourceAppRunId,invite.sourceSequence)) return;
      this.db.prepare('INSERT INTO deferred_invitation_sources VALUES (?,?,?)').run(invite.sourceAppRunId,invite.sourceSequence,invite.id);
      const current = this.current();
      if (current && (current.invite.state === 'pending' || current.invite.state === 'claimed')) return;
      this.save(invite, current && current.lastSeenWall > invite.createdAt ? current.lastSeenWall : invite.createdAt);
    }).immediate();
  }
  /** First read in a runtime session abandons an unacknowledged previous process claim. */
  read(value: unknown): DeferredGameInvitation | null {
    const now = timestamp(value);
    return this.db.transaction(() => {
      const row = this.current();
      if (!row) return null;
      this.validateSource(row.invite);
      const status = invitationTimeState(row.invite,Date.parse(now),Date.parse(row.lastSeenWall));
      const state = row.invite.state === 'claimed' ? 'abandoned'
        : row.invite.state === 'pending' && (status === 'cancelled' || status === 'expired') ? status : row.invite.state;
      const invite = { ...row.invite, state };
      this.save(invite,now > row.lastSeenWall ? now : row.lastSeenWall);
      return invite;
    }).immediate();
  }
  claim(value: unknown): boolean {
    const p = record(value,['id','now']), id = text(p.id), now = timestamp(p.now);
    return this.db.transaction(() => {
      const row = this.current();
      if (!row || row.invite.id !== id || row.invite.state !== 'pending') return false;
      this.validateSource(row.invite);
      const status = invitationTimeState(row.invite,Date.parse(now),Date.parse(row.lastSeenWall));
      const state = status === 'ready' ? 'claimed' : status === 'cancelled' || status === 'expired' ? status : 'pending';
      this.save({ ...row.invite,state },now > row.lastSeenWall ? now : row.lastSeenWall);
      return state === 'claimed';
    }).immediate();
  }
  finish(value: unknown): void {
    const p = record(value,['id','state']), id = text(p.id), state = deferredTerminal(p.state);
    this.db.transaction(() => {
      const row = this.current();
      if (!row || row.invite.id !== id || (row.invite.state !== 'pending' && row.invite.state !== 'claimed')) return;
      this.validateSource(row.invite);
      if (state === 'completed' && row.invite.state !== 'claimed') throw new MemoryDataError('conflict');
      this.save({ ...row.invite,state },row.lastSeenWall);
    }).immediate();
  }
  clear(): void { this.db.exec('DELETE FROM deferred_game_invitation; DELETE FROM deferred_invitation_sources;'); }
  private validateSource(invite: DeferredGameInvitation): void {
    const source = this.db.prepare('SELECT payload FROM causal_life_episodes WHERE app_run_id=? AND sequence=?').get(invite.sourceAppRunId,invite.sourceSequence);
    if (!source) throw new MemoryDataError('conflict');
    const episode = causalEpisode(JSON.parse(text(record(source).payload,4096)));
    if (episode.occurredAt !== invite.createdAt || !invitationSourceEligible(episode,Date.parse(invite.createdAt))) throw new MemoryDataError('invalid_data');
  }
  private current(): { readonly invite: DeferredGameInvitation; readonly lastSeenWall: string } | null {
    const row = this.db.prepare('SELECT payload,last_seen_wall FROM deferred_game_invitation WHERE singleton=1').get();
    if (!row) return null;
    const p = record(row);
    return { invite: deferredInvitation(JSON.parse(text(p.payload,4096))),lastSeenWall: timestamp(p.last_seen_wall) };
  }
  private save(invite: DeferredGameInvitation,lastSeenWall: string): void {
    this.db.prepare('INSERT INTO deferred_game_invitation VALUES (1,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload,last_seen_wall=excluded.last_seen_wall,source_app_run_id=excluded.source_app_run_id,source_sequence=excluded.source_sequence')
      .run(JSON.stringify(invite),lastSeenWall,invite.sourceAppRunId,invite.sourceSequence);
  }
}
