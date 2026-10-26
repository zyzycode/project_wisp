export function exactRecord(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid dialogue payload');
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) throw new TypeError('Invalid dialogue payload');
  const record = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || ![...keys, ...optional].includes(key)
        || !('value' in Object.getOwnPropertyDescriptor(record, key)!)) throw new TypeError('Invalid dialogue payload');
  }
  if (keys.some(key => !Object.hasOwn(record, key))) throw new TypeError('Invalid dialogue payload');
  return record;
}
export function plainText(value: unknown, max: number, trim = false): string {
  if (typeof value !== 'string') throw new TypeError('Invalid dialogue text');
  const text = trim ? value.trim() : value;
  if (!text.trim() || text.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) throw new TypeError('Invalid dialogue text');
  return text;
}
export function enumValue<const T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new TypeError('Invalid dialogue enum'); return value as T;
}
