import type Database from 'better-sqlite3';
/** Rebuild parent and children atomically with foreign-key enforcement continuously enabled. */
export function migrateBeverage(db: Database.Database, now: string): void {
  db.transaction(() => {
      const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='memory_items'").get() as { seq: number } | undefined;
      db.exec(`CREATE TEMP TABLE beverage_sources_backup AS SELECT * FROM memory_item_sources;
        CREATE TEMP TABLE beverage_terms_backup AS SELECT * FROM memory_item_terms;
        DROP TABLE memory_item_terms; DROP TABLE memory_item_sources;`);
      db.exec(`CREATE TABLE memory_items_v4 (
        insertion_order INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL CHECK(revision>0), status TEXT NOT NULL CHECK(status IN ('active','withdrawn')),
        category TEXT NOT NULL CHECK(category IN ('important_event','shared_joke','beverage_preference')),
        label TEXT NOT NULL, text TEXT NOT NULL, occurred_on TEXT, confirmed_at TEXT NOT NULL, command_id TEXT NOT NULL,
        source_user_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
        source_assistant_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
        beverage_value TEXT, beverage_provenance TEXT, beverage_validity TEXT, beverage_manually_corrected INTEGER,
        CHECK(source_user_id!=source_assistant_id),
        CHECK((category='beverage_preference' AND beverage_value IN ('coffee','tea') AND beverage_value IS NOT NULL
          AND beverage_provenance IN ('model_proposal','user_statement') AND beverage_provenance IS NOT NULL
          AND beverage_validity IN ('hypothesis','confirmed','rejected') AND beverage_validity IS NOT NULL
          AND (beverage_validity!='confirmed' OR beverage_provenance='user_statement')
          AND (beverage_validity!='rejected' OR status='withdrawn')
          AND (beverage_manually_corrected!=1 OR beverage_provenance='user_statement')
          AND (beverage_validity!='hypothesis' OR beverage_provenance='model_proposal')
          AND beverage_manually_corrected IN (0,1) AND beverage_manually_corrected IS NOT NULL)
          OR (category!='beverage_preference' AND beverage_value IS NULL AND beverage_provenance IS NULL
          AND beverage_validity IS NULL AND beverage_manually_corrected IS NULL))
      );
      INSERT INTO memory_items_v4 (insertion_order,id,revision,status,category,label,text,occurred_on,confirmed_at,command_id,source_user_id,source_assistant_id)
        SELECT insertion_order,id,revision,status,category,label,text,occurred_on,confirmed_at,command_id,source_user_id,source_assistant_id FROM memory_items;
      DROP TABLE memory_items;
      ALTER TABLE memory_items_v4 RENAME TO memory_items;
      CREATE TABLE memory_item_sources (item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE, user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT, assistant_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT, PRIMARY KEY(item_id,user_message_id,assistant_message_id), CHECK(user_message_id!=assistant_message_id));
      CREATE TABLE memory_item_terms (token TEXT NOT NULL,item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,insertion_order INTEGER NOT NULL,PRIMARY KEY(token,item_id));
      CREATE INDEX memory_terms_order ON memory_item_terms(token,insertion_order DESC,item_id);
      CREATE INDEX memory_sources_user ON memory_item_sources(user_message_id,item_id);
      CREATE INDEX memory_sources_assistant ON memory_item_sources(assistant_message_id,item_id);
      INSERT INTO memory_item_sources SELECT * FROM beverage_sources_backup;
      INSERT INTO memory_item_terms SELECT * FROM beverage_terms_backup;
      CREATE UNIQUE INDEX beverage_single_slot ON memory_items(category) WHERE category='beverage_preference';
      ALTER TABLE memory_mutation_receipts ADD COLUMN request_id TEXT;
      ALTER TABLE memory_mutation_receipts ADD COLUMN user_message_id TEXT;
      ALTER TABLE memory_mutation_receipts ADD COLUMN assistant_message_id TEXT;
      CREATE UNIQUE INDEX beverage_turn_request ON memory_mutation_receipts(request_id) WHERE request_id IS NOT NULL;
      CREATE UNIQUE INDEX beverage_turn_user ON memory_mutation_receipts(user_message_id) WHERE user_message_id IS NOT NULL;
      CREATE UNIQUE INDEX beverage_turn_assistant ON memory_mutation_receipts(assistant_message_id) WHERE assistant_message_id IS NOT NULL;`);
      if (sequence) {
        const updated = db.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='memory_items'").run(sequence.seq);
        if (updated.changes === 0) db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES ('memory_items',?)").run(sequence.seq);
      }
      for (const [table, backup] of [['memory_item_sources','beverage_sources_backup'],['memory_item_terms','beverage_terms_backup']]) {
        const mismatch = db.prepare(`SELECT * FROM ${table} EXCEPT SELECT * FROM ${backup}`).all();
        const missing = db.prepare(`SELECT * FROM ${backup} EXCEPT SELECT * FROM ${table}`).all();
        if (mismatch.length || missing.length) throw new Error('migration data mismatch');
      }
      db.exec('DROP TABLE beverage_sources_backup; DROP TABLE beverage_terms_backup;');
      const errors: unknown = db.pragma('foreign_key_check');
      if (!Array.isArray(errors) || errors.length) throw new Error('foreign key migration failure');
      db.prepare('INSERT INTO schema_migrations VALUES (4, ?, ?)').run('beverage_preference_v4', now);
      db.pragma('user_version = 4');
  }).immediate();
}
