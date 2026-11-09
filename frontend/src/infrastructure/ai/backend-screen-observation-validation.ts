import type { BackendScreenImage, BackendScreenObservationCapability, BackendScreenObservationRequest, ScreenObservationEvidence } from '../../application/ports/backend-screen-observation-contract';
import { parseScreenEvidence, screenRecord } from '../../shared/screen-observation-validation';
import { screenJpegDimensions } from '../platform/screen-image-validation';

export const SCREEN_POLICY_REVISION = 'screen-openai-2026-11' as const;
export function parseScreenCapability(value: unknown): BackendScreenObservationCapability {
  if (!value || typeof value !== 'object' || !('status' in value)) throw new TypeError('Invalid screen capability');
  if (value.status === 'available') {
    const r = screenRecord(value, ['status', 'provider', 'model', 'policyRevision']);
    if (r.provider !== 'openai' || r.model !== 'gpt-6-astra' || r.policyRevision !== SCREEN_POLICY_REVISION) throw new TypeError('Invalid screen capability');
    return { status: 'available', provider: 'openai', model: 'gpt-6-astra', policyRevision: SCREEN_POLICY_REVISION };
  }
  const r = screenRecord(value, ['status', 'reason']);
  if (r.status !== 'unavailable' || (r.reason !== 'unsupported_profile' && r.reason !== 'policy_unconfirmed')) throw new TypeError('Invalid screen capability');
  return { status: 'unavailable', reason: r.reason };
}
export function parseBackendScreenRequest(value: unknown): BackendScreenObservationRequest {
  const r = screenRecord(value, ['requestId', 'stream', 'locale', 'policyRevision', 'image']);
  if (typeof r.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(r.requestId)
    || r.stream !== false || (r.locale !== 'ru' && r.locale !== 'en') || r.policyRevision !== SCREEN_POLICY_REVISION) throw new TypeError('Invalid screen request');
  const i = screenRecord(r.image, ['mimeType', 'width', 'height', 'dataBase64']);
  if (i.mimeType !== 'image/jpeg' || typeof i.width !== 'number' || typeof i.height !== 'number' || !Number.isInteger(i.width) || !Number.isInteger(i.height)
    || typeof i.dataBase64 !== 'string' || i.dataBase64.length > 349528 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(i.dataBase64)) throw new TypeError('Invalid screen image');
  const bytes = Buffer.from(i.dataBase64, 'base64');
  const dimensions = screenJpegDimensions(bytes);
  if (bytes.toString('base64') !== i.dataBase64 || dimensions.width !== i.width || dimensions.height !== i.height) throw new TypeError('Invalid screen image');
  const image: BackendScreenImage = { mimeType: 'image/jpeg', width: i.width, height: i.height, dataBase64: i.dataBase64 };
  const result: BackendScreenObservationRequest = { requestId: r.requestId, stream: false, locale: r.locale, policyRevision: SCREEN_POLICY_REVISION, image };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 360448) throw new TypeError('Screen request too large');
  return result;
}
export function parseBackendScreenResponse(value: unknown, requestId: string): ScreenObservationEvidence {
  const r = screenRecord(value, ['requestId', 'observation']);
  if (r.requestId !== requestId || Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096) throw new TypeError('Invalid screen response');
  return parseScreenEvidence(r.observation);
}
