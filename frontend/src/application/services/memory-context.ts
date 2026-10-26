import type { AIProviderContextMessage } from '../ports/ai-provider.interface';
import { DEFAULT_CHAT_CONTEXT_LIMITS, type ChatContextLimits } from '../ports/memory-repository.interface';

/** Whole-pair suffix only: an oversized or incomplete pair is never partially retained. */
export function boundMemoryContext(messages: readonly AIProviderContextMessage[], limits: ChatContextLimits = DEFAULT_CHAT_CONTEXT_LIMITS): AIProviderContextMessage[] {
  if (messages.length % 2 !== 0 || ![limits.maxMessages, limits.maxTotalCharacters, limits.maxCharactersPerMessage].every(value => Number.isSafeInteger(value) && value >= 0)) return [];
  let start = messages.length, characters = 0;
  for (let end = messages.length; end >= 2; end -= 2) {
    const user = messages[end - 2]!, assistant = messages[end - 1]!;
    if (user.role !== 'user' || assistant.role !== 'wisp' || !user.text.trim() || !assistant.text.trim()
      || user.text.length > Math.min(240, limits.maxCharactersPerMessage) || assistant.text.length > limits.maxCharactersPerMessage) break;
    const length = user.text.length + assistant.text.length;
    if (messages.length - end + 2 > limits.maxMessages || characters + length > limits.maxTotalCharacters) break;
    characters += length; start = end - 2;
  }
  return messages.slice(start).map(message => ({ ...message }));
}
