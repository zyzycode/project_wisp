import path from 'node:path';
import type { ObservationCategory } from '../../application/ports/active-application-observation.port';

export interface ObservationExecutable {
  readonly appKey: string;
  readonly path: string;
  readonly excluded: boolean;
  readonly category: ObservationCategory;
}
export type ObservationHelperResponse = { readonly id: number } & (
  { readonly available: false; readonly reason: 'excluded' | 'permission_denied' } |
  { readonly available: true; readonly appKey: string; readonly episodeToken: string; readonly sourceToken: string;
    readonly appName: string; readonly windowTitle: string });
const TOKEN = /^[a-zA-Z0-9-]{1,80}$/;
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
export function safeObservationText(value: string, limit: number): string {
  let result = '';
  for (const scalar of value) {
    const code = scalar.codePointAt(0)!;
    if (FORBIDDEN.test(scalar) || (code >= 0xd800 && code <= 0xdfff)) continue;
    result += scalar;
  }
  let bounded = '';
  for (const scalar of result.trim()) {
    if (bounded.length + scalar.length > limit) break;
    bounded += scalar;
  }
  return bounded.trim();
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function parseObservationResponse(value: unknown, id: number, entries: readonly ObservationExecutable[]): ObservationHelperResponse {
  if (!record(value) || value.id !== id) throw new Error('Invalid observation response');
  if (value.available === false && exact(value, ['id', 'available', 'reason']) &&
    (value.reason === 'excluded' || value.reason === 'permission_denied')) return { id, available: false, reason: value.reason };
  if (value.available !== true || !exact(value, ['id', 'available', 'appKey', 'episodeToken', 'sourceToken', 'appName', 'windowTitle'])) {
    throw new Error('Invalid observation response');
  }
  const { appKey, episodeToken, sourceToken, appName, windowTitle } = value;
  if (typeof appKey !== 'string' || !entries.some(entry => entry.appKey === appKey && !entry.excluded) ||
    typeof episodeToken !== 'string' || !TOKEN.test(episodeToken) || typeof sourceToken !== 'string' || !TOKEN.test(sourceToken) ||
    typeof appName !== 'string' || appName.length === 0 || safeObservationText(appName, 80) !== appName ||
    typeof windowTitle !== 'string' || safeObservationText(windowTitle, 160) !== windowTitle) throw new Error('Invalid observation response');
  const entry = entries.find(item => item.appKey === appKey)!;
  if (safeObservationText(path.win32.basename(entry.path).slice(0, -4), 80) !== appName) throw new Error('Invalid observation identity');
  return { id, available: true, appKey, episodeToken, sourceToken, appName, windowTitle };
}
