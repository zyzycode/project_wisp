/** JSON.parse validates grammar; a token walk rejects duplicate object keys before projection. */
export function parseScreenJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const stack: (Set<string> | null)[] = [];
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]]/gu;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (text.slice(match.index + token.length).trimStart().startsWith(':')) {
      const keys = stack.at(-1), key: unknown = JSON.parse(token);
      if (!keys || typeof key !== 'string' || keys.has(key)) throw new TypeError('Invalid screen JSON');
      keys.add(key);
    }
  }
  return value;
}
