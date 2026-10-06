import path from 'node:path';
import { MemoryWorkerClient } from '../infrastructure/memory/worker-client';
import { createMemoryAdapters } from '../infrastructure/memory/adapters';

/** One Main-owned connection; Application use cases attach to these ports in #7/#8. */
export function createMainMemoryComposition(userDataPath: string, mainDirectory: string, now: string) {
  const client = new MemoryWorkerClient({
    workerPath: path.join(mainDirectory, 'memory-worker.js'),
    filename: path.join(userDataPath, 'memory', 'wisp.sqlite3'),
    now,
  });
  return { ...createMemoryAdapters(client), ready: client.ready,
    abandonStartup: () => client.abandonStartup(),
    abort: () => client.abort(),
    close: (generation: number) => client.close(generation) };
}
