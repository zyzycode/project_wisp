import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { ILocalAIBackend, LocalAIBackendBootstrap, LocalAIBackendStartResult } from '../../application/ports/ai-connection.interface';
import { encodeLocalAIBootstrap, localAIChildEnvironment, parseLocalAIReady, probeLocalAIHealth } from './local-ai-backend-protocol';

export interface ManagedAIChild {
  on(event: 'error', listener: () => void): unknown;
  once(event: 'exit', listener: () => void): unknown;
  removeListener(event: 'exit', listener: () => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
}
interface Options {
  readonly python: string | undefined;
  readonly directory: string | undefined;
  readonly env?: NodeJS.ProcessEnv;
  readonly spawn?: (python: string, directory: string, env: NodeJS.ProcessEnv) => ManagedAIChild;
  readonly validateRuntime?: (python: string, directory: string) => Promise<boolean>;
  readonly health?: typeof probeLocalAIHealth;
  readonly onUnavailable?: () => void;
}
async function validateRuntime(python: string, directory: string): Promise<boolean> {
  try {
    await access(python, constants.X_OK);
    return (await stat(python)).isFile() && (await stat(directory)).isDirectory();
  } catch { return false; }
}

/** Owns exactly one child: bounded startup/stop, private pipe bootstrap, no retries. */
export class ManagedLocalAIBackend implements ILocalAIBackend {
  private child: ManagedAIChild | null = null;
  private started = false;
  private retired = false;
  private exited = false;
  private stopWork: Promise<void> | null = null;
  private cancelStartup: (() => void) | null = null;
  constructor(private readonly options: Options) {}
  start(bootstrap: LocalAIBackendBootstrap): Promise<LocalAIBackendStartResult> {
    if (this.started || this.retired) return Promise.resolve({ ok: false, code: 'startup_failed' });
    this.started = true;
    const token = bootstrap.sessionToken;
    let record: string;
    try { record = encodeLocalAIBootstrap(bootstrap); }
    catch { return Promise.resolve({ ok: false, code: 'startup_failed' }); }
    bootstrap = { apiKey: '', sessionToken: '', ledgerPath: '' };
    return new Promise(resolve => {
      let settled = false, readyReceived = false, bytes = Buffer.alloc(0);
      const healthAbort = new AbortController();
      let healthTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: LocalAIBackendStartResult) => {
        if (settled) return;
        settled = true; record = ''; clearTimeout(startupTimer); clearTimeout(healthTimer); healthAbort.abort(); this.cancelStartup = null;
        if (!result.ok && !this.retired) void this.stop();
        resolve(result);
      };
      const fail = () => {
        if (settled) { this.options.onUnavailable?.(); void this.stop(); }
        else finish({ ok: false, code: 'startup_failed' });
      };
      const startupTimer = setTimeout(() => finish({ ok: false, code: 'startup_timeout' }), 10_000);
      this.cancelStartup = () => finish({ ok: false, code: 'startup_failed' });
      const launch = async () => {
        const { python, directory } = this.options;
        if (!python || !directory || !path.isAbsolute(python) || !path.isAbsolute(directory)
            || !await (this.options.validateRuntime ?? validateRuntime)(python, directory)) {
          finish({ ok: false, code: 'runtime_unavailable' }); return;
        }
        if (this.retired || settled) return;
        const child = (this.options.spawn ?? ((executable, cwd, env) => spawn(executable, ['-m', 'wisp_backend.managed'], {
          cwd, env, stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true,
        })))(python, directory, localAIChildEnvironment(this.options.env ?? process.env));
        this.child = child;
        child.on('error', fail);
        child.once('exit', () => { this.exited = true; if (!this.retired) fail(); });
        if (!child.stdin || !child.stdout) { fail(); return; }
        child.stdin.on('error', () => { if (!this.retired) fail(); });
        child.stdout.on('end', () => { if (!this.retired) fail(); });
        child.stdout.on('data', (chunk: Buffer) => {
          if (this.retired) return;
          if (readyReceived || !Buffer.isBuffer(chunk) || bytes.byteLength + chunk.byteLength > 256) { fail(); return; }
          bytes = Buffer.concat([bytes, chunk]);
          if (!bytes.includes(10)) return;
          let port: number;
          try { port = parseLocalAIReady(bytes).port; } catch { fail(); return; }
          readyReceived = true; bytes = Buffer.alloc(0);
          healthTimer = setTimeout(fail, 1000);
          void (this.options.health ?? probeLocalAIHealth)(port, token, healthAbort.signal).then(ok => {
            if (this.retired || settled) return;
            finish(ok ? { ok: true, port } : { ok: false, code: 'startup_failed' });
          }).catch(fail);
        });
        child.stdin.write(record, error => { if (error && !this.retired) fail(); });
        record = '';
      };
      void launch().catch(fail);
    });
  }
  stop(): Promise<void> {
    if (this.stopWork) return this.stopWork;
    this.retired = true;
    this.cancelStartup?.();
    const child = this.child;
    if (!child || this.exited) return Promise.resolve();
    this.stopWork = new Promise(resolve => {
      const finish = () => { clearTimeout(term); clearTimeout(kill); clearTimeout(deadline); child.removeListener('exit', finish); resolve(); };
      const signal = (value: NodeJS.Signals) => { try { child.kill(value); } catch { /* Already exited. */ } };
      const term = setTimeout(() => signal('SIGTERM'), 500);
      const kill = setTimeout(() => signal('SIGKILL'), 2000);
      const deadline = setTimeout(finish, 3000);
      child.once('exit', finish);
      try { child.stdin?.end(); } catch { signal('SIGTERM'); }
    });
    return this.stopWork;
  }
}
