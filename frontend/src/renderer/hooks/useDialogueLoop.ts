import { useState, useMemo, useEffect, useRef } from 'react';
import type { BrainStateDTO, WispApiBridge } from '../../shared/ipc-contracts';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { SpeechProjection } from '../speech-projection';
import { getDialogueCommandClient } from '../dialogue-command-client';
import type { IReplyOutput } from '../reply-output';

export interface UseDialogueLoopOptions {
  readonly bridge: Pick<WispApiBridge, 'postDialogueCommand'>;
  readonly snapshot: BrainStateDTO | null;
  readonly setCurrentMessage: (message: ChatMessage | null) => void;
  readonly output?: IReplyOutput;
}
/** UI command admission and presentation from the existing Brain snapshot. */
export function useDialogueLoop({ bridge, snapshot, setCurrentMessage, output }: UseDialogueLoopOptions) {
  const client = useMemo(() => getDialogueCommandClient(bridge), [bridge]);
  const [transport, setTransport] = useState(client.getState());
  const speech = useRef(new SpeechProjection());
  useEffect(() => client.subscribe(() => setTransport(client.getState())), [client]);
  useEffect(() => {
    if (!snapshot) return;
    client.accept(snapshot);
    if (!client.isCurrent(snapshot)) return;
    const message = speech.current.accept(snapshot);
    const turn = snapshot.dialogue.turn;
    if (message && output && turn.phase === 'completed' && turn.outcome.kind === 'success' && message.id === `${snapshot.dialogue.conversationId}:${turn.requestId}`) {
      output.submit({ streamId: snapshot.streamId, conversationId: snapshot.dialogue.conversationId, requestId: turn.requestId, text: turn.replyText, presentedAtMs: snapshot.sampledAtMs });
    } else if (message !== undefined) setCurrentMessage(message);
  }, [client, snapshot, setCurrentMessage, output]);
  return { replyTopic: transport.replyTopic, cancelTopic: client.cancelTopic, handleSendMessage: client.send, canSubmit: transport.canSubmit, error: transport.error, submissionMessage: transport.submissionMessage, isThinking: snapshot?.dialogue.turn.phase === 'thinking' };
}
