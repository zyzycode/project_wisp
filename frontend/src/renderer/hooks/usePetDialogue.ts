import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { BrainStateDTO, WispApiBridge } from '../../shared/ipc-contracts';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../render-engine/chat-message-presentation';
import { INTERACTION_REPLIES } from '../content/interaction-replies';
import { ContinuousVoiceClient } from '../continuous-voice-client';
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
  const { handleSendMessage, canSubmit, error, submissionMessage, replyTopic, cancelTopic, isThinking } = useDialogueLoop({
    bridge,
    snapshot,
    setCurrentMessage,
  });

  const voice = useMemo(() => new ContinuousVoiceClient(bridge.voiceInput, handleSendMessage), [bridge.voiceInput, handleSendMessage]);
  const voiceState = useSyncExternalStore(voice.subscribe, voice.getSnapshot, voice.getSnapshot);
  const streamId = snapshot?.streamId;
  const conversationId = snapshot?.dialogue.conversationId;
  useEffect(() => {
    voice.setContext(streamId && conversationId ? { streamId, conversationId } : null);
  }, [voice, streamId, conversationId]);
  useEffect(() => { voice.setCanSubmit(canSubmit); }, [voice, canSubmit]);
  useEffect(() => () => voice.disable(), [voice]);

  useEffect(() => {
    const welcomeTimer = window.setTimeout(() => {
      setCurrentMessage(current => current ?? createChatMessage('pet', INTERACTION_REPLIES.welcome));
    }, 1_000);
    return (): void => window.clearTimeout(welcomeTimer);
  }, []);

  const dismissMessage = useCallback(() => setCurrentMessage(null), []);
  const closeChat = useCallback(() => setChatOpen(false), []);

  return {
    memoryCards: { bridge, snapshot },
    voice, voiceState, voiceAvailable: Boolean(bridge.voiceInput), voiceContextReady: Boolean(streamId && conversationId),
    currentMessage,
    setCurrentMessage,
    chatOpen,
    setChatOpen,
    closeChat,
    dismissMessage,
    handleSendMessage, canSubmit, error, submissionMessage, replyTopic, cancelTopic, isThinking,
  };
}
