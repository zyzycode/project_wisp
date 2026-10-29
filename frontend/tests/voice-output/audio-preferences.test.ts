import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { FileAudioOutputPreferences } from '../../src/infrastructure/voice-output/audio-output-preferences';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'wisp-audio-prefs-')); roots.push(root); return { root, prefs: new FileAudioOutputPreferences(root) }; }
it('retains only the last selected device across restart and clears it for system default', async () => {
  const { root, prefs } = await fixture(); expect(await prefs.read()).toEqual({ ok: true, deviceId: '' });
  await Promise.all([prefs.write('first'), prefs.write('second')]);
  expect(await new FileAudioOutputPreferences(root).read()).toEqual({ ok: true, deviceId: 'second' });
  expect(JSON.parse(await readFile(path.join(root, 'audio-output.json'), 'utf8'))).toEqual({ deviceId: 'second' });
  await prefs.write(''); expect(await prefs.read()).toEqual({ ok: true, deviceId: '' });
});
it.each(['not JSON', JSON.stringify({ deviceId: 'x', label: 'forbidden' }), 'x'.repeat(4097)])('rejects damaged/oversized settings without silently choosing another output', async data => {
  const { root, prefs } = await fixture(); await writeFile(path.join(root, 'audio-output.json'), data);
  expect(await prefs.read()).toEqual({ ok: false });
});
it('rejects invalid IDs and reports write failures', async () => {
  const { root, prefs } = await fixture(); expect(await prefs.write('x'.repeat(513))).toEqual({ ok: false });
  await writeFile(path.join(root, 'blocked'), 'file');
  expect(await new FileAudioOutputPreferences(path.join(root, 'blocked')).write('device')).toEqual({ ok: false });
});
