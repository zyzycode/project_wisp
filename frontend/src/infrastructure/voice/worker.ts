import { parentPort, workerData } from 'node:worker_threads';
interface Input { readonly modelPath: string; readonly samples: Float32Array; readonly language: 'ru' | 'en' }
async function run(input: Input): Promise<void> {
  // Lazy import isolates unavailable native binaries from application startup.
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = false; env.allowLocalModels = true; env.useFSCache = false;
  const recognizer = await pipeline('automatic-speech-recognition', input.modelPath, {
    device: 'cpu', dtype: 'q8', local_files_only: true,
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
  try {
    const output = await recognizer(input.samples, { language: input.language, task: 'transcribe', return_timestamps: false });
    if (Array.isArray(output)) throw new Error('Invalid result');
    parentPort?.postMessage({ ok: true, value: output.text });
  } finally { await recognizer.dispose(); }
}
void run(workerData as Input).catch(() => parentPort?.postMessage({ ok: false, code: 'recognition_failed' }));
