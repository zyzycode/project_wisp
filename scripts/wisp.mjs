import { wispCommands } from './commands.mjs';
import { runProcesses } from './processes.mjs';

const mode = process.argv[2] || 'help';
if (mode === 'help') {
  console.log('Usage: node scripts/wisp.mjs <command> [test arguments]');
  console.log('Commands: dev, dev:frontend, dev:backend, typecheck, test, test:frontend,');
  console.log('          test:backend, test:python, test:tooling, check:backend, sprites:validate');
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const specs = wispCommands(mode, process.argv.slice(3));
    if (mode === 'dev') {
      console.log('Starting Wisp. Personal AI is managed from the application. Ctrl+C stops Wisp.');
      process.exitCode = await runProcesses(specs, { signal: controller.signal });
    } else {
      for (const spec of specs) {
        process.exitCode = await runProcesses([spec], { signal: controller.signal });
        if (process.exitCode || controller.signal.aborted) break;
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
