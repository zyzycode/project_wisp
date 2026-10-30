import { parentPort, workerData } from 'node:worker_threads';
import { voiceSessionOptions } from './inference-coordinator';
interface Input { readonly requestId: number; readonly samples: Float32Array; readonly language: 'ru' | 'en' }
async function createRecognizer(modelPath: string) {
  // Lazy import isolates unavailable native binaries from application startup.
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = false; env.allowLocalModels = true; env.useFSCache = false;
  return pipeline('automatic-speech-recognition', modelPath, {
    device: 'cpu', dtype: 'q8', local_files_only: true,
    session_options: voiceSessionOptions(threads),
  });
}
const { modelPath, threads } = workerData as { readonly modelPath: string; readonly threads: number };
if (typeof modelPath !== 'string') throw new Error('Invalid speech configuration');
voiceSessionOptions(threads);
let recognizer: ReturnType<typeof createRecognizer> | undefined;
let busy = false;
parentPort?.on('message', (input: Input) => {
  if (busy) { parentPort?.postMessage({ requestId: input.requestId, ok: false }); return; }
  busy = true;
  void (async () => {
    const model = await (recognizer ??= createRecognizer(modelPath));
    const output = await model(input.samples, { language: input.language, task: 'transcribe', return_timestamps: false });
    if (Array.isArray(output)) throw new Error('Invalid result');
    parentPort?.postMessage({ requestId: input.requestId, ok: true, value: output.text });
  })().catch(() => parentPort?.postMessage({ requestId: input.requestId, ok: false }))
    .finally(() => { busy = false; });
});
