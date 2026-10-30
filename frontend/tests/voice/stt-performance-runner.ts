import path from 'node:path';
import { createHash } from 'node:crypto';
import { env, pipeline } from '@huggingface/transformers';
import { OnoAnnaInference } from '../../src/infrastructure/voice-output/inference';
import { TTS_MODEL, TTS_TOKENIZER } from '../../src/infrastructure/voice-output/model-manifest';
import { VOICE_MODEL } from '../../src/infrastructure/voice/model-manifest';
import { VoiceModelCache, verifiedFile } from '../../src/infrastructure/voice/model-cache';
import { voiceSessionOptions } from '../../src/infrastructure/voice/inference-coordinator';
interface Fixture { readonly language: 'ru' | 'en'; readonly samples: Float32Array }
const root = process.argv[2]!;
const send = (value: object) => new Promise<void>((resolve, reject) => {
  if (!process.send) { reject(new Error('Missing probe parent')); return; }
  process.send(value, error => error ? reject(error) : resolve());
});
await send({ phase: 'start', mode: process.argv[3] === 'fixtures' ? 'fixtures' : 'stt' });
env.allowRemoteModels = false; env.allowLocalModels = true; env.useFSCache = false;
if (process.argv[3] === 'fixtures') {
  for (const manifest of [TTS_MODEL, TTS_TOKENIZER]) for (const file of manifest.files) {
    if (!await verifiedFile(path.join(root, manifest.revision, file.path), file)) throw new Error('Invalid model resource');
  }
  const tts = await OnoAnnaInference.create(path.join(root, TTS_MODEL.revision), path.join(root, TTS_TOKENIZER.revision));
  const fixtures: Fixture[] = [];
  try {
    for (const language of ['ru', 'en'] as const) {
      let seed = 42; Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const pcm = await tts.synthesize(language === 'ru' ? 'Привет!' : 'Hello!', language);
      const samples = Float32Array.from({ length: Math.floor(pcm.length * 2 / 3) }, (_, i) => {
        const position = i * 1.5, lo = Math.floor(position), fraction = position - lo;
        return pcm[lo]! * (1 - fraction) + (pcm[Math.min(lo + 1, pcm.length - 1)]! * fraction);
      });
      fixtures.push({ language, samples });
    }
  } finally { await tts.dispose(); }
  await send({ phase: 'fixtures', fixtures });
} else {
  const received = new Promise<Fixture[]>(resolve => process.once('message', value => resolve(value as Fixture[])));
  if (!await new VoiceModelCache(path.dirname(root)).verify()) throw new Error('Invalid speech input resources');
  const threads = Number(process.argv[4]), spinning = process.argv[5] === '1';
  const started = performance.now();
  const model = await pipeline('automatic-speech-recognition', path.join(root, VOICE_MODEL.revision), {
    device: 'cpu', dtype: 'q8', local_files_only: true, session_options: voiceSessionOptions(threads, spinning),
  });
  await send({ phase: 'load', threads, spinning, loadMs: performance.now() - started, revision: VOICE_MODEL.revision });
  try {
    for (const fixture of await received) for (let repeat = 0; repeat < 2; repeat++) {
      const cpu = process.cpuUsage();
      const before = performance.now();
      const output = await model(fixture.samples, { language: fixture.language, task: 'transcribe', return_timestamps: false });
      if (Array.isArray(output)) throw new Error('Unexpected transcript shape');
      const usedCpu = process.cpuUsage(cpu);
      const normalized = output.text.toLowerCase().normalize('NFC').replace(/[^\p{L}]/gu, '');
      await send({ phase: 'transcribe', threads, spinning, language: fixture.language, repeat,
        inferenceMs: performance.now() - before, pcmMs: fixture.samples.length / 16,
        peakRssKiB: process.resourceUsage().maxRSS, cpuMs: (usedCpu.user + usedCpu.system) / 1000, matchesExpected: normalized === (fixture.language === 'ru' ? 'привет' : 'hello'),
        transcriptHash: createHash('sha256').update(normalized).digest('hex') });
    }
  } finally { await model.dispose(); }
}
process.disconnect?.();
