import type { BackendCharacterContext } from './backend-ai-contract';

/** Explicit user contact, with no invented dialogue or memory writes. */
export interface BackendTouchRequest {
  readonly requestId: string;
  readonly event: { readonly type: 'user_touch'; readonly variant: 'stroke' | 'touch' | 'ruffle' | 'poke' };
  readonly stream: false;
  readonly locale: 'ru' | 'en';
  readonly character: BackendCharacterContext;
}
