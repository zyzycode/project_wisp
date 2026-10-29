import { spawn } from 'node:child_process';

// Host tooling only: this does not run inside the desktop runtime.
export function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else {
    // The spawned POSIX process group includes Vite's Electron child.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  }
}

export async function runProcesses(specs, { signal, spawnProcess = spawn, stop = stopChild, abortExitCode = 0 } = {}) {
  if (signal?.aborted) return abortExitCode;
  const children = [];
  let stopping = false;
  let result = 0;
  const shutdown = code => {
    if (stopping) return;
    stopping = true;
    result = code;
    for (const child of children) stop(child);
  };
  const onAbort = () => shutdown(abortExitCode);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const exits = specs.map(spec => new Promise(resolve => {
      const child = spawnProcess(spec.command, spec.args, {
        cwd: spec.cwd, env: spec.env, stdio: 'inherit', windowsHide: true,
        detached: process.platform !== 'win32',
      });
      children.push(child);
      child.on('error', error => {
        console.error(`[${spec.name}] Could not start: ${error.message}`);
        shutdown(1);
        resolve();
      });
      child.on('close', code => {
        if (!stopping) shutdown(code ?? 1);
        resolve();
      });
    }));
    await Promise.all(exits);
    return result;
  } catch (error) {
    shutdown(1);
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
