import type { ObservationCommandDTO, ObservationSettingsDTO } from './observation-contracts';
import { exactRecord, enumValue, plainText } from './dialogue-ipc-validation';
function generation(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid observation generation'); return value; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') throw new TypeError('Invalid observation flag'); return value; }
function id(value: unknown): string { const text = plainText(value, 128); if (text.trim() !== text) throw new TypeError('Invalid observation identity'); return text; }
export function parseObservationCommand(value: unknown): ObservationCommandDTO {
  const r = exactRecord(value, ['type', 'streamId', 'generation'], ['appKey', 'excluded']);
  const type = enumValue(r.type, ['get', 'pick', 'enable', 'disable', 'pause', 'resume', 'clear', 'preview-open', 'preview-close', 'remove', 'exclude']);
  exactRecord(r, ['type', 'streamId', 'generation', ...(type === 'exclude' ? ['appKey', 'excluded'] : type === 'remove' ? ['appKey'] : [])]);
  const base = { streamId: id(r.streamId), generation: generation(r.generation) };
  return type === 'remove' ? { ...base, type, appKey: id(r.appKey) } : type === 'exclude' ? { ...base, type, appKey: id(r.appKey), excluded: bool(r.excluded) } : { ...base, type };
}
export function parseObservationSettings(value: unknown): ObservationSettingsDTO {
  const r = exactRecord(value, ['generation', 'enabled', 'paused', 'status', 'reason', 'applications', 'previewOpen', 'preview']);
  if (!Array.isArray(r.applications) || r.applications.length > 32) throw new TypeError('Invalid observation applications');
  const applications = r.applications.map((value: unknown) => {
    const a = exactRecord(value, ['appKey', 'alias', 'category', 'excluded']);
    return { appKey: id(a.appKey), alias: plainText(a.alias, 80), category: enumValue(a.category, ['editor', 'other', 'unknown']), excluded: bool(a.excluded) };
  });
  if (new Set(applications.map(a => a.appKey)).size !== applications.length) throw new TypeError('Duplicate observation application');
  let preview: ObservationSettingsDTO['preview'] = null;
  if (r.preview !== null) { const p = exactRecord(r.preview, ['appName', 'windowTitle']); if (typeof p.windowTitle !== 'string' || p.windowTitle.length > 160) throw new TypeError('Invalid preview title'); preview = { appName: plainText(p.appName, 80), windowTitle: p.windowTitle }; }
  const result: ObservationSettingsDTO = { generation: generation(r.generation), enabled: bool(r.enabled), paused: bool(r.paused),
    status: enumValue(r.status, ['off', 'paused', 'available', 'unavailable']), reason: r.reason === null ? null : enumValue(r.reason, ['backend_unavailable', 'disabled', 'paused', 'unsupported', 'initializing', 'excluded', 'permission_denied', 'bridge_failed', 'stale']),
    applications, previewOpen: bool(r.previewOpen), preview };
  if (preview && (!result.previewOpen || result.status !== 'available')) throw new TypeError('Invalid observation preview');
  return result;
}
