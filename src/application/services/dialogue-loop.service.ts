import type {
  IAIProvider,
  AIProviderRequest,
  AIProviderUserMessage,
  AIProviderContextMessage,
} from '../ports/ai-provider.interface';
import type { BehaviorIntent } from '../../domain/behavior/behavior-intent';
import type { AnimationEvent } from '../../domain/animation/animation-state-machine';
import { mapProviderResponseToBehaviorIntent } from './provider-response-intent-mapper';

export interface DialogueTurnParams {
  aiProvider: IAIProvider;
  userText: string;
  characterMood: string;
  characterActivity: string;
  recentContext?: AIProviderContextMessage[];
  locale?: string;
}

export interface DialogueTurnResult {
  intent: BehaviorIntent;
  replyText?: string;
  userMessage: AIProviderUserMessage;
  contextMessage?: AIProviderContextMessage;
}

/**
 * Maps a BehaviorIntent to the corresponding AnimationEvent for character animation FSM.
 */
export function applyBehaviorIntentToAnimation(
  intent: BehaviorIntent,
  dispatchAnim: (event: AnimationEvent, force?: boolean) => boolean
): void {
  switch (intent.kind) {
    case 'react_happy':
    case 'play':
      dispatchAnim('REACT_HAPPY');
      break;
    case 'react_confused':
      dispatchAnim('REACT_CONFUSED');
      break;
    case 'sleep':
      dispatchAnim('START_SLEEP');
      break;
    case 'wake':
      dispatchAnim('WAKE_UP');
      break;
    case 'respond':
      if (intent.moodHint === 'happy') {
        dispatchAnim('REACT_HAPPY');
      } else if (intent.moodHint === 'confused') {
        dispatchAnim('REACT_CONFUSED');
      } else if (intent.moodHint === 'sleepy') {
        dispatchAnim('START_SLEEP');
      } else {
        dispatchAnim('SETTLE');
      }
      break;
    case 'idle':
    case 'quiet':
    default:
      dispatchAnim('SETTLE');
      break;
  }
}

/**
 * Executes a single turn of the dialogue cycle in the application layer.
 * Constructs the typed AIProviderRequest, generates the response via IAIProvider port,
 * and maps the response to an actionable BehaviorIntent.
 */
export async function processDialogueTurn({
  aiProvider,
  userText,
  characterMood,
  characterActivity,
  recentContext = [],
  locale = 'ru',
}: DialogueTurnParams): Promise<DialogueTurnResult> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const userMessage: AIProviderUserMessage = {
    id: `msg_${Date.now()}`,
    text: userText,
    createdAt: new Date().toISOString(),
  };

  const request: AIProviderRequest = {
    requestId,
    userMessage,
    characterSnapshot: {
      needs: {
        energy: 85,
        attention: characterActivity === 'idle' ? 35 : 25,
        play: 30,
        comfort: 20,
      },
      relationship: {
        friendship: 0,
        love: 0,
        loveUnlocked: false,
      },
      personality: {
        presetId: 'shyDreamGirl',
        aiSelfConcept:
          'Wisp is a shy, gentle, emotionally sensitive anime-like companion.',
        traits: {
          shyness: characterMood === 'shy' ? 0.8 : 0.55,
          playfulness: 0.42,
          sensitivity: 0.88,
          boldness: 0.18,
        },
      },
      intimacy: {
        flirtiness: 0,
        romanticCharge: 0,
        userConsentEnabled: false,
      },
      synthesizedTone: characterMood === 'sleepy' ? 'sleepy' : 'neutral',
    },
    recentContext: recentContext.slice(-6),
    locale,
  };

  const response = await aiProvider.generateResponse(request);
  const intent = mapProviderResponseToBehaviorIntent(response);

  const contextMessage: AIProviderContextMessage | undefined = intent.replyText
    ? {
        role: 'wisp',
        text: intent.replyText,
        createdAt: new Date().toISOString(),
      }
    : undefined;

  return {
    intent,
    replyText: intent.replyText,
    userMessage,
    contextMessage,
  };
}
