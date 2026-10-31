import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { BrainStateDTO, WispApiBridge } from '../../shared/ipc-contracts';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../render-engine/chat-message-presentation';
import { INTERACTION_REPLIES } from '../content/interaction-replies';
import { ContinuousVoiceClient } from '../continuous-voice-client';
import { useDialogueLoop } from './useDialogueLoop';
import { ReplyOutputRouter, TextReplyOutput } from '../reply-output';
import { VoiceReplyOutput } from '../voice-reply-output';

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
  const voiceOutput = useMemo(() => new VoiceReplyOutput(bridge.voiceOutput), [bridge.voiceOutput]);
  const outputState = useSyncExternalStore(voiceOutput.subscribe, voiceOutput.getSnapshot, voiceOutput.getSnapshot);
  const output = useMemo(() => new ReplyOutputRouter({ text: new TextReplyOutput(setCurrentMessage), voice: voiceOutput,
    voiceEnabled: () => voiceOutput.getSnapshot().enabled }), [voiceOutput]);
  const { handleSendMessage, canSubmit, error, submissionMessage, replyTopic, cancelTopic, isThinking } = useDialogueLoop({
    bridge,
    snapshot,
    setCurrentMessage,
    output,
  });

  const voice = useMemo(() => new ContinuousVoiceClient(bridge.voiceInput, handleSendMessage, undefined, { connection: bridge.aiConnection, confirm: message => window.confirm(message) }), [bridge.voiceInput, bridge.aiConnection, handleSendMessage]);
  const voiceState = useSyncExternalStore(voice.subscribe, voice.getSnapshot, voice.getSnapshot);
  const streamId = snapshot?.streamId;
  const conversationId = snapshot?.dialogue.conversationId;
  useEffect(() => {
    voice.setContext(streamId && conversationId ? { streamId, conversationId } : null);
  }, [voice, streamId, conversationId]);
  useEffect(() => {
    let active = true;
    if (streamId && conversationId) queueMicrotask(() => { if (active) { void voiceOutput.configureAtStartup(); } });
    return () => { active = false; };
  }, [voiceOutput, streamId, conversationId]);
  useEffect(() => { voice.setCanSubmit(canSubmit); }, [voice, canSubmit]);
  useEffect(() => { voice.setOutputBlocked(outputState.phase === 'preparing' || outputState.phase === 'speaking'); }, [voice, outputState.phase]);
  useEffect(() => { void voiceOutput.initialize(); return () => voiceOutput.dispose(); }, [voiceOutput]);
  useEffect(() => {
    if (!streamId || !conversationId) return;
    return () => voiceOutput.clear();
  }, [voiceOutput, streamId, conversationId]);
  useEffect(() => { if (voiceState.phase === 'listening') void voiceOutput.audio.refresh(); }, [voiceOutput, voiceState.phase]);
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
    voiceOutput, outputState, outputAvailable: Boolean(bridge.voiceOutput),
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
