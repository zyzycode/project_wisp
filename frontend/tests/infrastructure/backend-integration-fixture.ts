import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as realTimeout, clearTimeout as clearRealTimeout } from 'node:timers';

interface BackendResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly upstreamCalls: number;
  readonly upstreamMessages: readonly { readonly role: string; readonly content: string }[];
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function response(value: unknown): BackendResponse {
  if (!record(value) || !Number.isInteger(value.status) || typeof value.status !== 'number' || value.status < 100 || value.status > 599
    || typeof value.contentType !== 'string' || typeof value.body !== 'string' || typeof value.upstreamCalls !== 'number'
    || !Array.isArray(value.upstreamMessages)) throw new Error('Invalid backend bridge response');
  const upstreamMessages = value.upstreamMessages.map((item: unknown) => {
    if (!record(item) || typeof item.role !== 'string' || typeof item.content !== 'string') throw new Error('Invalid backend bridge message');
    return { role: item.role, content: item.content };
  });
  return { status: value.status, contentType: value.contentType, body: value.body, upstreamCalls: value.upstreamCalls, upstreamMessages };
}

/** JSON bytes cross the process boundary; neither runtime imports the other runtime. */
export async function backendIntegrationFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wisp-backend-integration-'));
  const child = spawn(process.env.WISP_PYTHON ?? 'python', ['-u', '-m', 'tests.desktop_integration_bridge', path.join(directory, 'ledger.sqlite')], {
    cwd: path.resolve('../backend'), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
  });
  let pending: { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof realTimeout> } | undefined;
  let buffer = Buffer.alloc(0), stderrBytes = 0, closed = false, failed: Error | undefined;
  let exited = false, closing: Promise<void> | undefined;
  const exit = new Promise<void>(resolve => child.once('close', () => { exited = true; resolve(); }));
  const fail = (error: Error) => {
    failed ??= error;
    if (pending) { clearRealTimeout(pending.timer); pending.reject(error); pending = undefined; }
    if (!exited) child.kill();
  };
  child.on('error', () => fail(new Error('Backend bridge process error')));
  child.stdin.on('error', () => fail(new Error('Backend bridge input error')));
  child.on('close', code => {
    if (pending || (!closed && code !== 0)) fail(new Error(`Backend bridge exited (${code})`));
  });
  child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 8192) fail(new Error('Backend bridge stderr limit')); });
  child.stdout.on('data', (chunk: Buffer) => {
    if (failed) return;
    if (buffer.length + chunk.length > 128 * 1024) { fail(new Error('Backend bridge stdout limit')); return; }
    buffer = Buffer.concat([buffer, chunk]);
    const newline = buffer.indexOf(10);
    if (newline < 0) return;
    if (newline !== buffer.length - 1 || !pending) { fail(new Error('Unexpected backend bridge frame')); return; }
    try {
      const value: unknown = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
      buffer = Buffer.alloc(0); const current = pending; pending = undefined; clearRealTimeout(current.timer); current.resolve(value);
    } catch { fail(new Error('Invalid backend bridge JSON')); }
  });
  function next(timeoutMs: number): Promise<unknown> {
    if (failed || closed || pending || exited) return Promise.reject(failed ?? new Error('Backend bridge unavailable'));
    return new Promise((resolve, reject) => {
      const timer = realTimeout(() => fail(new Error('Backend bridge deadline')), timeoutMs);
      pending = { resolve, reject, timer };
    });
  }
  async function waitForExit(timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof realTimeout> | undefined;
    try { return await Promise.race([exit.then(() => true), new Promise<false>(resolve => { timer = realTimeout(() => resolve(false), timeoutMs); })]); }
    finally { if (timer) clearRealTimeout(timer); }
  }
  function close(): Promise<void> {
    if (closing) return closing;
    closed = true;
    if (pending) { clearRealTimeout(pending.timer); pending.reject(new Error('Backend bridge closed')); pending = undefined; }
    child.stdin.end();
    closing = (async () => {
      if (!await waitForExit(2000)) { child.kill(); if (!await waitForExit(2000)) throw new Error('Backend bridge failed to exit'); }
      await rm(directory, { recursive: true, force: true });
    })();
    return closing;
  }
  try {
    const ready = await next(10000);
    if (!record(ready) || ready.ready !== true) throw new Error('Backend bridge did not become ready');
  } catch (error) { await close(); throw error; }
  const requests: { readonly path: string; readonly body: unknown }[] = [], responses: BackendResponse[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    if (failed || closed || pending || exited) throw failed ?? new Error('Backend bridge unavailable');
    const url = new URL(String(input));
    if (typeof init?.body !== 'string' || init.method !== 'POST') throw new Error('Expected serialized POST');
    if (init.signal?.aborted) throw new Error('Aborted backend request');
    const frame = JSON.stringify({ method: init.method, path: url.pathname, body: init.body }) + '\n';
    if (Buffer.byteLength(frame) > 64 * 1024) throw new Error('Backend bridge input limit');
    requests.push({ path: url.pathname, body: JSON.parse(init.body) as unknown });
    const received = next(12000);
    child.stdin.write(frame);
    const result = response(await received); responses.push(result);
    return new Response(result.body, { status: result.status, headers: { 'Content-Type': result.contentType } });
  };
  return { fetch: fetcher, requests, responses, close, isClosed: () => exited };
}
