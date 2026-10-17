/** Additive migration: schema1 SQL and original source rows remain unchanged. */
export const MEMORY_ITEMS_SCHEMA = `
ALTER TABLE messages ADD COLUMN memory_confirmable INTEGER NOT NULL DEFAULT 0 CHECK(memory_confirmable IN (0, 1));
CREATE TABLE memory_items (
  insertion_order INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision > 0),
  status TEXT NOT NULL CHECK(status IN ('active', 'withdrawn')),
  category TEXT NOT NULL CHECK(category IN ('important_event', 'shared_joke')),
  label TEXT NOT NULL, text TEXT NOT NULL, occurred_on TEXT,
  confirmed_at TEXT NOT NULL, command_id TEXT NOT NULL,
  source_user_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  source_assistant_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  CHECK(source_user_id != source_assistant_id)
);
CREATE TABLE memory_item_sources (
  item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  assistant_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  PRIMARY KEY(item_id, user_message_id, assistant_message_id), CHECK(user_message_id != assistant_message_id)
);
CREATE TABLE memory_item_terms (
  token TEXT NOT NULL, item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  insertion_order INTEGER NOT NULL, PRIMARY KEY(token, item_id)
);
CREATE INDEX memory_terms_order ON memory_item_terms(token, insertion_order DESC, item_id);
CREATE TABLE memory_suppressed_pairs (
  user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  assistant_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  PRIMARY KEY(user_message_id, assistant_message_id), CHECK(user_message_id != assistant_message_id)
);
CREATE INDEX memory_suppressed_assistant ON memory_suppressed_pairs(assistant_message_id);
CREATE TABLE memory_mutation_receipts (
  command_id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, item_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0), outcome TEXT NOT NULL, digest TEXT NOT NULL
);
`;
export const MEMORY_ITEM_TABLES = ['memory_items', 'memory_item_sources', 'memory_item_terms', 'memory_suppressed_pairs', 'memory_mutation_receipts'] as const;
