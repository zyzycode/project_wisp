/** Additive schema3; no transcript rewriting or automatic topic extraction. */
export const INTEREST_THREAD_TABLES = ['interest_thread', 'interest_thread_receipts'] as const;
export const INTEREST_THREAD_SCHEMA = `
CREATE TABLE interest_thread (
 id TEXT PRIMARY KEY NOT NULL CHECK(id='singleton'),
 thread_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 state TEXT NOT NULL CHECK(state IN ('unanswered','answered','closed')),
 text TEXT, reason TEXT,
 source_user_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
 source_assistant_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
 stated_at TEXT NOT NULL, confirmed_at TEXT NOT NULL, eligible_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 attempt_request_id TEXT, attempt_user_id TEXT, attempted_at TEXT,
 answer_user_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
 answer_assistant_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
 CHECK(source_user_id!=source_assistant_id),
 CHECK((attempt_request_id IS NULL AND attempt_user_id IS NULL AND attempted_at IS NULL) OR
       (attempt_request_id IS NOT NULL AND attempt_user_id IS NOT NULL AND attempted_at IS NOT NULL)),
 CHECK((state='unanswered' AND text IS NOT NULL AND reason IS NULL AND answer_user_id IS NULL AND answer_assistant_id IS NULL) OR
       (state='answered' AND text IS NULL AND reason IS NULL AND answer_user_id IS NOT NULL AND answer_assistant_id IS NOT NULL AND answer_user_id!=answer_assistant_id) OR
       (state='closed' AND text IS NULL AND reason IN ('declined','dismissed','expired','source_changed') AND answer_user_id IS NULL AND answer_assistant_id IS NULL))
);
CREATE TABLE interest_thread_receipts (
 kind TEXT NOT NULL CHECK(kind IN ('confirm','close','delete','turn')),
 command_id TEXT NOT NULL, digest TEXT NOT NULL,
 thread_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 outcome TEXT NOT NULL CHECK(outcome IN ('unanswered','answered','closed','deleted')),
 user_message_id TEXT, assistant_message_id TEXT,
 PRIMARY KEY(kind,command_id),
 CHECK((kind='turn' AND user_message_id IS NOT NULL AND assistant_message_id IS NOT NULL AND user_message_id!=assistant_message_id) OR
       (kind!='turn' AND user_message_id IS NULL AND assistant_message_id IS NULL))
);
CREATE UNIQUE INDEX interest_turn_user ON interest_thread_receipts(user_message_id) WHERE kind='turn';
CREATE UNIQUE INDEX interest_turn_assistant ON interest_thread_receipts(assistant_message_id) WHERE kind='turn';
`;
