import type { CursorGamePresentationDTO } from './ipc-contracts';
import { exactRecord, enumValue, plainText } from './dialogue-ipc-validation';
function id(value: unknown): string {
  const text = plainText(value, 128);
  if (text !== text.trim()) throw new TypeError('Invalid game ID');
  return text;
}
function time(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError('Invalid game time');
  return value;
}
export function parseCursorGame(value: unknown, sampledAtMs: number): CursorGamePresentationDTO | null {
  if (value === null) return null;
  const r = exactRecord(value, ['runId', 'outcome', 'speech']);
  const runId = id(r.runId);
  const outcome = r.outcome === null ? null : enumValue(r.outcome, ['caught', 'missed', 'lost_target', 'cancelled']);
  if (r.speech === null) return { runId, outcome, speech: null };
  const s = exactRecord(r.speech, ['id', 'text', 'startedAtMs', 'expiresAtMs']);
  const startedAtMs = time(s.startedAtMs), expiresAtMs = time(s.expiresAtMs);
  if (startedAtMs > sampledAtMs || expiresAtMs <= startedAtMs || expiresAtMs <= sampledAtMs || outcome === 'cancelled') {
    throw new TypeError('Invalid game speech lifetime');
  }
  return { runId, outcome, speech: { id: id(s.id), text: plainText(s.text, 240), startedAtMs, expiresAtMs } };
}
