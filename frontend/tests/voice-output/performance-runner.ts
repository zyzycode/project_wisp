import { createHash } from 'node:crypto';
import path from 'node:path';
import { env } from 'onnxruntime-node';
import { OnoAnnaInference, type SpeechInferenceOptions } from '../../src/infrastructure/voice-output/inference';
import { verifiedFile } from '../../src/infrastructure/voice/model-cache';
import { TTS_MODEL, TTS_TOKENIZER } from '../../src/infrastructure/voice-output/model-manifest';

const root = process.argv[2]!;
const threads = Number(process.argv[3]) as NonNullable<SpeechInferenceOptions['threads']>;
const spinning = process.argv[4] === '1';
let metrics: Record<string, { ms: number; calls: number }> = {};
const send = (value: object) => process.send?.(value);
const verificationStarted = performance.now();
for (const manifest of [TTS_MODEL, TTS_TOKENIZER]) for (const file of manifest.files) {
  if (!await verifiedFile(path.join(root, manifest.revision, file.path), file)) throw new Error('Unverified speech resource');
}
send({ phase: 'verify', verificationMs: performance.now() - verificationStarted });
const started = performance.now();
const engine = await OnoAnnaInference.create(path.join(root, TTS_MODEL.revision), path.join(root, TTS_TOKENIZER.revision), {
  threads, spinning, onGraphRun: (graph, ms) => { const metric = metrics[graph] ??= { ms: 0, calls: 0 }; metric.ms += ms; metric.calls++; },
});
send({ phase: 'load', threads, spinning, loadMs: performance.now() - started, peakRssKiB: process.resourceUsage().maxRSS,
  modelRevision: TTS_MODEL.revision, node: process.versions.node, ort: env.versions });
const fixtures = process.argv[5] === 'full'
  ? [{ id: 'A', text: 'Привет!' }, { id: 'B', text: 'Как дела?' }, { id: 'C', text: 'Сегодня хорошая погода. Давай немного поговорим.' }]
  : [{ id: 'A', text: 'Привет!' }];
try {
  for (const fixture of fixtures) for (let repeat = 0; repeat < 2; repeat++) {
    // Seed is confined to this disposable child. Production sampling remains unchanged.
    let seed = 42;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    metrics = {};
    send({ phase: 'synthesis-start', phrase: fixture.id, repeat });
    const cpu = process.cpuUsage();
    const before = performance.now();
    const samples = await engine.synthesize(fixture.text, 'ru');
    const synthesisMs = performance.now() - before;
    const usedCpu = process.cpuUsage(cpu);
    const pcmMs = samples.length / 24;
    send({ phase: 'synthesis', threads, spinning, phrase: fixture.id, repeat, synthesisMs, pcmMs, rtf: synthesisMs / pcmMs,
      peakRssKiB: process.resourceUsage().maxRSS, cpuMs: (usedCpu.user + usedCpu.system) / 1000, metrics,
      pcmHash: createHash('sha256').update(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)).digest('hex') });
  }
} finally { await engine.dispose(); }
process.disconnect?.();
