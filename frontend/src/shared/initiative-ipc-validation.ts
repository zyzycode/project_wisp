import type { InitiativeConsentCommandDTO, InitiativeControlCommandDTO } from '../application/ports/initiative-controls.interface';
import type { WindowHelpDeclineCommandDTO } from '../application/ports/window-help.interface';
import { exactRecord, plainText } from './dialogue-ipc-validation';

export function parseInitiativeRead(value: unknown): InitiativeControlCommandDTO {
  const record = exactRecord(value, ['streamId']);
  return { streamId: plainText(record.streamId, 512, true) };
}
export function parseInitiativeConsent(value: unknown): InitiativeConsentCommandDTO {
  const record = exactRecord(value, ['streamId', 'profileGeneration', 'enabled']);
  if (typeof record.enabled !== 'boolean' || typeof record.profileGeneration !== 'number'
    || !Number.isSafeInteger(record.profileGeneration) || record.profileGeneration < 0) {
    throw new TypeError('Invalid initiative consent');
  }
  return { streamId: plainText(record.streamId, 512, true), profileGeneration: record.profileGeneration,
    enabled: record.enabled };
}
export function parseWindowHelpDecline(value: unknown): WindowHelpDeclineCommandDTO {
  const record = exactRecord(value, ['streamId', 'requestId']);
  return { streamId: plainText(record.streamId, 512, true), requestId: plainText(record.requestId, 512, true) };
}
