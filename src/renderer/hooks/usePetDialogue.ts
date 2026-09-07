import { useCallback, useEffect, useState } from 'react';
import type { BrainStateDTO, WispApiBridge } from '../../shared/ipc-contracts';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../../domain/chat/chat-message';
import { INTERACTION_REPLIES } from '../content/interaction-replies';
import { useDialogueLoop } from './useDialogueLoop';

export interface UsePetDialogueOptions {
  readonly bridge: WispApiBridge;
  readonly snapshot: BrainStateDTO | null;
}

/** Owns dialogue presentation state and every timer/async effect behind it. */
export function usePetDialogue({
  bridge,
  snapshot,
}: UsePetDialogueOptions) {
  const [currentMessage, setCurrentMessage] = useState<ChatMessage | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const { handleSendMessage, canSubmit, error, isThinking } = useDialogueLoop({
    bridge,
    snapshot,
    setCurrentMessage,
  });

  useEffect(() => {
    const welcomeTimer = window.setTimeout(() => {
      setCurrentMessage(current => current ?? createChatMessage('pet', INTERACTION_REPLIES.welcome));
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
    handleSendMessage, canSubmit, error, isThinking,
  };
}
