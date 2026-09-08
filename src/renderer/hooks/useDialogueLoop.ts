import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { BrainStateDTO, WispApiBridge } from '../../shared/ipc-contracts';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { SpeechProjection } from '../speech-projection';
import { getDialogueCommandClient } from '../dialogue-command-client';

export interface UseDialogueLoopOptions {
  readonly bridge: Pick<WispApiBridge, 'postDialogueCommand'>;
  readonly snapshot: BrainStateDTO | null;
  readonly setCurrentMessage: (message: ChatMessage | null) => void;
}
/** UI command admission and presentation from the existing Brain snapshot. */
export function useDialogueLoop({ bridge, snapshot, setCurrentMessage }: UseDialogueLoopOptions) {
  const client = useMemo(() => getDialogueCommandClient(bridge), [bridge]);
  const [transport, setTransport] = useState(client.getState());
  const speech = useRef(new SpeechProjection());
  useEffect(() => client.subscribe(() => setTransport(client.getState())), [client]);
  useEffect(() => {
    if (!snapshot) return;
    client.accept(snapshot);
    if (!client.isCurrent(snapshot)) return;
    const message = speech.current.accept(snapshot);
    if (message !== undefined) setCurrentMessage(message);
  }, [client, snapshot, setCurrentMessage]);
  const handleSendMessage = useCallback((text: string) => client.send(text), [client]);
  return { handleSendMessage, canSubmit: transport.canSubmit, error: transport.error, isThinking: snapshot?.dialogue.turn.phase === 'thinking' };
}
