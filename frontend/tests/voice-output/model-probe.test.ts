import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { TTS_MODEL, TTS_TOKENIZER } from '../../src/infrastructure/voice-output/model-manifest';

// Explicit local integration probe; normal unit gates never require downloaded model weights.
it.skipIf(process.env.WISP_TTS_PROBE !== '1')('matches official Qwen2 golden IDs and generates finite RU/EN Ono_Anna speech offline', async () => {
  const { createSpeechTokenizer } = await import('../../src/infrastructure/voice-output/tokenizer');
  const root = path.resolve('.cache/voice-models');
  const tokenizer = await createSpeechTokenizer(path.join(root, TTS_TOKENIZER.revision));
  const golden: readonly { readonly text: string; readonly ids: readonly number[]; readonly templateIds: readonly number[] }[] = JSON.parse(await readFile(path.resolve('tests/voice-output/tokenizer-golden.json'), 'utf8'));
  for (const item of golden) {
    expect(tokenizer.encode(item.text, { add_special_tokens: false })).toEqual(item.ids);
    expect(tokenizer.encode(`<|im_start|>assistant\n${item.text}<|im_end|>\n<|im_start|>assistant\n`, { add_special_tokens: false })).toEqual(item.templateIds);
  }
  const { OnoAnnaInference } = await import('../../src/infrastructure/voice-output/inference');
  const started = performance.now();
  const engine = await OnoAnnaInference.create(path.join(root, TTS_MODEL.revision), path.join(root, TTS_TOKENIZER.revision));
  try {
    const loadMs = performance.now() - started;
    for (const language of ['ru', 'en'] as const) {
      const before = performance.now();
      const samples = await engine.synthesize(language === 'ru' ? 'Привет!' : 'Hello!', language);
      expect(samples.length).toBeGreaterThan(0); expect(samples.length).toBeLessThanOrEqual(2_880_000);
      expect(samples.every(n => Number.isFinite(n) && Math.abs(n) <= 1)).toBe(true);
      expect(samples.some(n => Math.abs(n) > 0.01)).toBe(true);
      process.stdout.write(JSON.stringify({ probe: 'ono_anna', language, loadMs: Math.round(loadMs), inferenceMs: Math.round(performance.now() - before), audioMs: samples.length / 24, peakRssKiB: process.resourceUsage().maxRSS }) + '\n');
    }
  } finally { await engine.dispose(); }
}, 300_000);
