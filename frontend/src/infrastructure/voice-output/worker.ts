import { OnoAnnaInference } from './inference';
interface Input { readonly threads: number; readonly id: number; readonly text: string; readonly language: 'ru' | 'en'; readonly modelRoot: string; readonly tokenizerRoot: string }
let engine: Promise<OnoAnnaInference> | undefined;
let busy = false;
let configuredThreads: number | undefined;
process.parentPort.on('message', (event: Electron.MessageEvent) => {
  const value: unknown = event.data;
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id < 1 ||
    !('text' in value) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 2000 ||
    !('language' in value) || (value.language !== 'ru' && value.language !== 'en') ||
    !('modelRoot' in value) || typeof value.modelRoot !== 'string' || !('tokenizerRoot' in value) || typeof value.tokenizerRoot !== 'string') return;
  if (!('threads' in value) || typeof value.threads !== 'number' || !Number.isInteger(value.threads) || value.threads < 1 || value.threads > 8 ||
    (configuredThreads !== undefined && configuredThreads !== value.threads)) { process.parentPort.postMessage({ id: value.id, ok: false }); return; }
  configuredThreads = value.threads;
  const input: Input = { threads: value.threads, id: value.id, text: value.text, language: value.language, modelRoot: value.modelRoot, tokenizerRoot: value.tokenizerRoot };
  if (busy) { process.parentPort.postMessage({ id: input.id, ok: false }); return; }
  busy = true;
  void (async () => {
    const model = await (engine ??= OnoAnnaInference.create(input.modelRoot, input.tokenizerRoot, { threads: input.threads }));
    const samples = await model.synthesize(input.text, input.language);
    process.parentPort.postMessage({ id: input.id, ok: true, samples });
  })().catch(() => process.parentPort.postMessage({ id: input.id, ok: false }))
    .finally(() => { busy = false; });
});
