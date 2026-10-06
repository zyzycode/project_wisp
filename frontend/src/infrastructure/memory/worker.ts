import { parentPort, workerData } from 'node:worker_threads';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SqliteMemoryStore } from './sqlite-store';
import { command, failure } from './protocol';
import { record, text, timestamp } from './validation';

const port = parentPort;
if (!port) throw new Error('Memory worker requires a parent');
let store: SqliteMemoryStore | undefined;
try {
  const data = record(workerData, ['filename', 'now']);
  const filename = text(data.filename, 32768);
  mkdirSync(path.dirname(filename), { recursive: true });
  store = SqliteMemoryStore.open(filename, timestamp(data.now));
  port.postMessage({ id: 0, result: { ok: true, value: undefined } });
} catch (error) {
  port.postMessage({ id: 0, result: failure(error) });
  port.close();
}
port.on('message', (input: unknown) => {
  try {
    const c = command(input);
    port.postMessage({ id: c.id, result: store?.execute(c) ?? { ok: false, code: 'unavailable' } });
    if (c.operation === 'close') { store?.close(); port.close(); }
  } catch { store?.close(); port.close(); }
});
