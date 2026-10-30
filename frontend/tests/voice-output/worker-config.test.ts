import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ create: vi.fn(), synthesize: vi.fn(async () => new Float32Array([0.1])) }));
vi.mock('../../src/infrastructure/voice-output/inference', () => ({ OnoAnnaInference: { create: native.create } }));
const original = Object.getOwnPropertyDescriptor(process, 'parentPort');
afterEach(() => { if (original) Object.defineProperty(process, 'parentPort', original); else Reflect.deleteProperty(process, 'parentPort'); native.create.mockReset(); native.synthesize.mockClear(); });
async function worker() {
  vi.resetModules();
  const port = new EventEmitter(); const postMessage = vi.fn();
  Object.defineProperty(process, 'parentPort', { configurable: true, value: Object.assign(port, { postMessage }) });
  native.create.mockResolvedValue({ synthesize: native.synthesize });
  await import('../../src/infrastructure/voice-output/worker');
  return { postMessage, send: (threads: unknown, id = 1) => port.emit('message', { data: { id, text: 'Привет!', language: 'ru', modelRoot: '/model', tokenizerRoot: '/tokenizer', threads } }) };
}
it.each([undefined, 0, 9, NaN, 1.5])('rejects private CPU config %s before model load', async threads => {
  const port = await worker(); port.send(threads);
  expect(native.create).not.toHaveBeenCalled(); expect(port.postMessage).toHaveBeenCalledWith({ id: 1, ok: false });
});
it('pins the validated thread budget for the warm child lifetime', async () => {
  const port = await worker(); port.send(3);
  await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ id: 1, ok: true, samples: expect.any(Float32Array) }));
  expect(native.create).toHaveBeenCalledWith('/model', '/tokenizer', { threads: 3 });
  port.send(4, 2); expect(port.postMessage).toHaveBeenLastCalledWith({ id: 2, ok: false });
  expect(native.create).toHaveBeenCalledOnce();
});
