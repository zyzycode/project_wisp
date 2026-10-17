import { plainText } from './dialogue-ipc-validation';
/** V5 aligns with Python Unicode Cc/Cs: only newline/tab are allowed controls. */
export function summaryPlainText(value: unknown, max: number): string {
  const text = plainText(value, max);
  if (/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uD800-\uDFFF]/u.test(text)) throw new TypeError('Invalid summary text');
  return text;
}
