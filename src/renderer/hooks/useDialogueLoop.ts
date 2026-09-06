import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { BrainStateDTO, WispApiBridge } from '../../shared/ipc-contracts';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../../domain/chat/chat-message';
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
  const shown = useRef<string | null>(null);
  useEffect(() => client.subscribe(() => setTransport(client.getState())), [client]);
  useEffect(() => {
    if (!snapshot) return;
    client.accept(snapshot);
    if (!client.isCurrent(snapshot)) return;
    const turn = snapshot.dialogue.turn;
    if (turn.phase === 'idle') { if (shown.current !== null) setCurrentMessage(null); shown.current = null; return; }
    if (turn.phase !== 'completed' && turn.phase !== 'error') return;
    const key = `${snapshot.streamId}:${snapshot.dialogue.conversationId}:${turn.requestId}`;
    if (shown.current === key) return;
    shown.current = key;
    setCurrentMessage(createChatMessage('pet', turn.phase === 'completed' ? turn.replyText : turn.message));
  }, [client, snapshot, setCurrentMessage]);
  const handleSendMessage = useCallback((text: string) => client.send(text), [client]);
  return { handleSendMessage, canSubmit: transport.canSubmit, error: transport.error, isThinking: snapshot?.dialogue.turn.phase === 'thinking' };
}
