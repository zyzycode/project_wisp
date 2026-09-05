import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  IAIProvider,
  AIProviderContextMessage,
} from '../../application/ports/ai-provider.interface';
import {
  processDialogueTurn,
  applyBehaviorIntentToAnimation,
} from '../../application/services/dialogue-loop.service';
import type {
  AnyAnimationState,
  AnimationEvent,
} from '../../domain/animation/animation-state-machine';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../../domain/chat/chat-message';
import { DialogueEffectLifecycle } from '../body-ui-runtime';

export interface UseDialogueLoopOptions {
  aiProvider: IAIProvider;
  animState: AnyAnimationState;
  setCurrentMessage: (message: ChatMessage | null) => void;
  dispatchAnim: (event: AnimationEvent, force?: boolean) => boolean;
  locale?: string;
}

export { applyBehaviorIntentToAnimation };

/**
 * React hook orchestrating the offline dialogue loop:
 * ChatInput -> Thinking state -> AI Provider -> BehaviorIntent -> SpeechBubble & Animation FSM.
 */
export function useDialogueLoop({
  aiProvider,
  setCurrentMessage,
  dispatchAnim,
  locale = 'ru',
}: UseDialogueLoopOptions) {
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const recentContextRef = useRef<AIProviderContextMessage[]>([]);
  const lifecycleRef = useRef(new DialogueEffectLifecycle());

  useEffect(() => {
    lifecycleRef.current.mount();
    return (): void => {
      lifecycleRef.current.dispose();
      recentContextRef.current = [];
    };
  }, []);

  const handleSendMessage = useCallback(
    async (userText: string) => {
      // 1. Immediately transition character into thinking state
      dispatchAnim('THINK', true);
      setIsThinking(true);

      try {
        const turnResult = await processDialogueTurn({
          aiProvider,
          userText,
          recentContext: recentContextRef.current,
          locale,
        });
        if (!lifecycleRef.current.isActive()) return;

        // Update context window
        recentContextRef.current.push({
          role: 'user',
          text: userText,
          createdAt: turnResult.userMessage.createdAt,
        });

        if (turnResult.contextMessage) {
          recentContextRef.current.push(turnResult.contextMessage);
        }

        if (recentContextRef.current.length > 10) {
          recentContextRef.current = recentContextRef.current.slice(-10);
        }

        // 2. Display reply in SpeechBubble
        if (turnResult.replyText) {
          setCurrentMessage(createChatMessage('pet', turnResult.replyText));
        }

        // 3. Update Animation FSM based on intent
        applyBehaviorIntentToAnimation(turnResult.intent, dispatchAnim);
      } catch (err) {
        if (!lifecycleRef.current.isActive()) return;
        console.error('Dialogue error:', err);
        dispatchAnim('REACT_CONFUSED');
        setCurrentMessage(
          createChatMessage('pet', 'Ой, что-то пошло не так... Но я всё равно рядом!')
        );
      } finally {
        if (lifecycleRef.current.isActive()) setIsThinking(false);
      }
    },
    [aiProvider, setCurrentMessage, dispatchAnim, locale]
  );

  return {
    isThinking,
    handleSendMessage,
  };
}
