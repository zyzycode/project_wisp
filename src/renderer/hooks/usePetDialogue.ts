import { useCallback, useEffect, useState } from 'react';
import type { IAIProvider } from '../../application/ports/ai-provider.interface';
import type { AnyAnimationState, AnimationEvent } from '../../domain/animation/animation-state-machine';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../../domain/chat/chat-message';
import { INTERACTION_REPLIES } from '../content/interaction-replies';
import { useDialogueLoop } from './useDialogueLoop';

export interface UsePetDialogueOptions {
  readonly aiProvider: IAIProvider;
  readonly animState: AnyAnimationState;
  readonly dispatchAnim: (event: AnimationEvent, force?: boolean, loop?: boolean) => boolean;
}

/** Owns dialogue presentation state and every timer/async effect behind it. */
export function usePetDialogue({
  aiProvider,
  animState,
  dispatchAnim,
}: UsePetDialogueOptions) {
  const [currentMessage, setCurrentMessage] = useState<ChatMessage | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const { handleSendMessage } = useDialogueLoop({
    aiProvider,
    animState,
    setCurrentMessage,
    dispatchAnim,
    locale: 'ru',
  });

  useEffect(() => {
    const welcomeTimer = window.setTimeout(() => {
      setCurrentMessage(createChatMessage('pet', INTERACTION_REPLIES.welcome));
    }, 1_000);
    return (): void => window.clearTimeout(welcomeTimer);
  }, []);

  const dismissMessage = useCallback(() => setCurrentMessage(null), []);
  const closeChat = useCallback(() => setChatOpen(false), []);

  return {
    currentMessage,
    setCurrentMessage,
    chatOpen,
    setChatOpen,
    closeChat,
    dismissMessage,
    handleSendMessage,
  };
}
