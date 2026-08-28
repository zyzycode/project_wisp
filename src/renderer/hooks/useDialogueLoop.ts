import { useState, useRef, useCallback } from 'react';
import type {
  IAIProvider,
  AIProviderContextMessage,
} from '../../application/ports/ai-provider.interface';
import {
  processDialogueTurn,
  applyBehaviorIntentToAnimation,
} from '../../application/services/dialogue-loop.service';
import type {
  AnimationState,
  AnimationEvent,
} from '../../domain/animation/animation-state-machine';
import type { PetAffectionState } from '../../domain/interaction/pet-interaction';
import { recordPetInteraction } from '../../domain/interaction/pet-interaction';
import type { ChatMessage } from '../../domain/chat/chat-message';
import { createChatMessage } from '../../domain/chat/chat-message';

export interface UseDialogueLoopOptions {
  aiProvider: IAIProvider;
  animState: AnimationState;
  affection: PetAffectionState;
  setAffection: React.Dispatch<React.SetStateAction<PetAffectionState>>;
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
  animState,
  affection,
  setAffection,
  setCurrentMessage,
  dispatchAnim,
  locale = 'ru',
}: UseDialogueLoopOptions) {
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const recentContextRef = useRef<AIProviderContextMessage[]>([]);

  const handleSendMessage = useCallback(
    async (userText: string) => {
      // 1. Record interaction for affection calculation
      setAffection((prev) => recordPetInteraction(prev, 'single_click'));

      // 2. Immediately transition character into thinking state
      dispatchAnim('THINK', true);
      setIsThinking(true);

      try {
        const turnResult = await processDialogueTurn({
          aiProvider,
          userText,
          characterMood: affection.mood,
          characterActivity: animState,
          recentContext: recentContextRef.current,
          locale,
        });

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

        // 3. Display reply in SpeechBubble
        if (turnResult.replyText) {
          setCurrentMessage(createChatMessage('pet', turnResult.replyText));
        }

        // 4. Update Animation FSM based on intent
        applyBehaviorIntentToAnimation(turnResult.intent, dispatchAnim);
      } catch (err) {
        console.error('Dialogue error:', err);
        dispatchAnim('REACT_CONFUSED');
        setCurrentMessage(
          createChatMessage('pet', 'Ой, что-то пошло не так... Но я всё равно рядом!')
        );
      } finally {
        setIsThinking(false);
      }
    },
    [aiProvider, animState, affection, setAffection, setCurrentMessage, dispatchAnim, locale]
  );

  return {
    isThinking,
    handleSendMessage,
  };
}
