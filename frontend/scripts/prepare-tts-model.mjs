import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVoiceModel } from './prepare-voice-model.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function prepareTtsModel() {
  const source = await readFile(path.join(root, 'src/infrastructure/voice-output/model-manifest.ts'), 'utf8');
  for (const name of ['TTS_MODEL', 'TTS_TOKENIZER']) {
    const match = source.match(new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\}) as const;`, 'u'));
    if (!match) throw new Error('Invalid pinned TTS manifest');
    await prepareVoiceModel({ manifest: JSON.parse(match[1]), signal: AbortSignal.timeout(1_800_000) });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareTtsModel();
  console.log('Pinned speech output model verified for offline delivery.');
}
