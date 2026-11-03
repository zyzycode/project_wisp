export class MemoryDataError extends Error {
  constructor(readonly code: 'invalid_data' | 'conflict' | 'unsupported_version' | 'unavailable' | 'corrupt') { super(code); }
}
export function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MemoryDataError('invalid_data');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new MemoryDataError('invalid_data');
  const result = value as Record<string, unknown>;
  if (Reflect.ownKeys(result).some(key => typeof key !== 'string' || !('value' in Object.getOwnPropertyDescriptor(result, key)!))) throw new MemoryDataError('invalid_data');
  if (keys && (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)))) throw new MemoryDataError('invalid_data');
  return result;
}
export function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new MemoryDataError('invalid_data');
  return value;
}
export function timestamp(value: unknown): string {
  const result = text(value, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new MemoryDataError('invalid_data');
  return result;
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new MemoryDataError('invalid_data');
  return value;
}
export function finite(value: unknown, min = 0, max = Number.MAX_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new MemoryDataError('invalid_data');
  return value;
}
