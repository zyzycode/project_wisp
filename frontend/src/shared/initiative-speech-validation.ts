import type { AIInitiativeSpeechDTO } from './ipc-contracts';
import { exactRecord, plainText } from './dialogue-ipc-validation';
export function parseInitiativeSpeech(value: unknown, sampledAtMs: number): AIInitiativeSpeechDTO | null {
  if (value === null) return null;
  const r = exactRecord(value, ['id', 'text', 'startedAtMs', 'expiresAtMs']);
  const id = plainText(r.id, 128); if (id !== id.trim()) throw new TypeError('Invalid speech identity');
  const start = r.startedAtMs, end = r.expiresAtMs;
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 || start > sampledAtMs
    || typeof end !== 'number' || !Number.isFinite(end) || end <= sampledAtMs || end <= start || end - start > 2000) throw new TypeError('Invalid speech lifetime');
  return { id, text: plainText(r.text, 240, true), startedAtMs: start, expiresAtMs: end };
}
