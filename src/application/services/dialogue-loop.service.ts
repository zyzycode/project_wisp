import type {
  IAIProvider,
  AIProviderRequest,
  AIProviderUserMessage,
  AIProviderContextMessage,
  AIProviderSuggestedMood,
  AIProviderTone,
} from '../ports/ai-provider.interface';
import type { CharacterSnapshot, SynthesizedEmotionalTone } from '../../domain/character';
import type { BehaviorIntent } from '../../domain/behavior/behavior-intent';
import type { AnimationEvent } from '../../domain/animation/animation-state-machine';
import {
  CharacterStateService,
  defaultCharacterStateService,
} from './character-state.service';
import { mapProviderResponseToBehaviorIntent } from './provider-response-intent-mapper';

export interface DialogueTurnParams {
  aiProvider: IAIProvider;
  userText: string;
  characterSnapshot?: CharacterSnapshot;
  characterStateService?: CharacterStateService;
  recentContext?: AIProviderContextMessage[];
  locale?: string;
}

export interface DialogueTurnResult {
  intent: BehaviorIntent;
  replyText?: string;
  userMessage: AIProviderUserMessage;
  contextMessage?: AIProviderContextMessage;
  characterSnapshot: CharacterSnapshot;
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

function providerToneToCharacterTone(
  tone?: AIProviderTone,
  mood?: AIProviderSuggestedMood
): SynthesizedEmotionalTone | undefined {
  const providerToneOrMood = tone ?? mood;

  switch (providerToneOrMood) {
    case 'playful':
    case 'sleepy':
    case 'curious':
    case 'shy':
    case 'affectionate':
    case 'neutral':
      return providerToneOrMood;
    case 'warm':
      return 'affectionate';
    case 'confused':
    case 'quiet':
      return 'neutral';
    case 'happy':
      return 'playful';
    case undefined:
      return undefined;
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
  characterSnapshot,
  characterStateService = defaultCharacterStateService,
  recentContext = [],
  locale = 'ru',
}: DialogueTurnParams): Promise<DialogueTurnResult> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const userMessage: AIProviderUserMessage = {
    id: `msg_${Date.now()}`,
    text: userText,
    createdAt: new Date().toISOString(),
  };
  const resolvedCharacterSnapshot =
    characterSnapshot ??
    (() => {
      characterStateService.applyStimulus({
        type: 'user_message',
        source: 'user',
        text: userText,
        requestId,
        createdAt: userMessage.createdAt,
      });

      return characterStateService.getSnapshot();
    })();

  const request: AIProviderRequest = {
    requestId,
    userMessage,
    characterSnapshot: resolvedCharacterSnapshot,
    recentContext: recentContext.slice(-6),
    locale,
  };

  const response = await aiProvider.generateResponse(request);
  const intent = mapProviderResponseToBehaviorIntent(response);

  if (characterSnapshot === undefined) {
    characterStateService.applyStimulus({
      type: 'provider_response',
      source: 'provider',
      text: response.reply.text,
      requestId,
      createdAt: new Date().toISOString(),
      metadata: {
        tone: providerToneToCharacterTone(response.reply.tone, response.suggestedMood) ?? null,
      },
    });
  }

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
    characterSnapshot: resolvedCharacterSnapshot,
  };
}
