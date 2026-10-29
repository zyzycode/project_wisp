import { parentPort, workerData } from 'node:worker_threads';
import { OnoAnnaInference } from './inference';
interface Input { readonly id: number; readonly text: string; readonly language: 'ru' | 'en' }
const { modelRoot, tokenizerRoot } = workerData as { readonly modelRoot: string; readonly tokenizerRoot: string };
let engine: Promise<OnoAnnaInference> | undefined;
let busy = false;
parentPort?.on('message', (input: Input) => {
  if (busy) { parentPort?.postMessage({ id: input.id, ok: false }); return; }
  busy = true;
  void (async () => {
    const model = await (engine ??= OnoAnnaInference.create(modelRoot, tokenizerRoot));
    const samples = await model.synthesize(input.text, input.language);
    if (!(samples.buffer instanceof ArrayBuffer)) throw new Error('Invalid audio buffer');
    parentPort?.postMessage({ id: input.id, ok: true, samples }, [samples.buffer]);
  })().catch(() => parentPort?.postMessage({ id: input.id, ok: false }))
    .finally(() => { busy = false; });
});
