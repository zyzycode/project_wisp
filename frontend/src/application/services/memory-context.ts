import type { AIProviderContextMessage } from '../ports/ai-provider.interface';
import { DEFAULT_CHAT_CONTEXT_LIMITS, type ChatContextLimits } from '../ports/memory-repository.interface';

export function boundMemoryContext(messages: readonly AIProviderContextMessage[], limits: ChatContextLimits = DEFAULT_CHAT_CONTEXT_LIMITS): AIProviderContextMessage[] {
  const bounded = messages.slice(-limits.maxMessages).map(message => {
    let end = Math.min(message.text.length, limits.maxCharactersPerMessage);
    if (end < message.text.length && end > 0 && /[\uD800-\uDBFF]/u.test(message.text[end - 1]!)) end--;
    return { ...message, text: message.text.slice(0, end) };
  });
  let length = bounded.reduce((sum, message) => sum + message.text.length, 0);
  while (length > limits.maxTotalCharacters && bounded.length) length -= bounded.shift()!.text.length;
  return bounded;
}
