import type { BackendAIMessage } from '../../application/ports/backend-ai-contract';
/** Preserve all required fields/current user, removing only an oldest complete history pair. */
export function fitChatRequestBytes<T extends { readonly messages: readonly BackendAIMessage[] }>(request: T): T {
  let result = request;
  while (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32768 && result.messages.length > 1) {
    result = { ...result, messages: result.messages.slice(2) };
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32768) throw new TypeError('Request too large');
  return result;
}
