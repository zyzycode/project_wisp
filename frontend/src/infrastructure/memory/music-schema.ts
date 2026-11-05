import type Database from 'better-sqlite3';
export const MUSIC_SCHEMA = `
CREATE TABLE music_samples (opening_id TEXT PRIMARY KEY,continuation_id TEXT NOT NULL UNIQUE,topic TEXT NOT NULL,day TEXT NOT NULL,occurred_at TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(topic,day));
CREATE INDEX music_samples_topic_time ON music_samples(topic,occurred_at,opening_id);
CREATE TABLE music_user_preferences (topic TEXT PRIMARY KEY,occurred_at TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE music_clock (id INTEGER PRIMARY KEY CHECK(id=1),last_clock TEXT NOT NULL);
`;
export function migrateMusic(db: Database.Database): void {
  db.exec(MUSIC_SCHEMA);
  db.exec('ALTER TABLE messages ADD COLUMN music_intention INTEGER NOT NULL DEFAULT 0; ALTER TABLE messages ADD COLUMN music_sample_digest TEXT; ALTER TABLE messages ADD COLUMN music_preference_consumed INTEGER NOT NULL DEFAULT 0;');
  const remove = `DELETE FROM music_samples WHERE opening_id=OLD.id OR continuation_id=OLD.id OR json_extract(payload,'$.opening.assistantMessageId')=OLD.id OR json_extract(payload,'$.continuation.assistantMessageId')=OLD.id; DELETE FROM music_user_preferences WHERE json_extract(payload,'$.source.userMessageId')=OLD.id OR json_extract(payload,'$.source.assistantMessageId')=OLD.id;`;
  db.exec(`CREATE TRIGGER music_source_deleted AFTER DELETE ON messages BEGIN ${remove} END; CREATE TRIGGER music_source_corrected AFTER UPDATE OF content,created_at,role,conversation_session_id,memory_confirmable ON messages BEGIN ${remove} END;`);
}
