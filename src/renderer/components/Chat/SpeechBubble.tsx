import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../domain/chat/chat-message';

export const SPEECH_BUBBLE_FADE_OUT_MS = 200;
const SPEECH_BUBBLE_ENTER_DELAY_MS = 16;

export interface SpeechBubbleProps {
  message: ChatMessage | null;
  onDismiss?: () => void;
}

export type SpeechBubblePhase = 'entering' | 'visible' | 'exiting';

interface SpeechBubbleTimerRef {
  current: ReturnType<typeof setTimeout> | undefined;
}

interface SpeechBubbleDismissGate {
  current: boolean;
}

export interface SpeechBubbleViewProps {
  message: ChatMessage;
  phase: SpeechBubblePhase;
  onDismissRequested: () => void;
}

export function calculateSpeechBubbleDuration(text: string): number {
  return Math.min(10_000, Math.max(3_000, 2_500 + text.length * 45));
}

export function getSpeechBubbleDisplayDuration(message: ChatMessage): number {
  return message.durationMs ?? calculateSpeechBubbleDuration(message.text);
}

export function scheduleSpeechBubbleAutoDismiss(
  message: ChatMessage,
  onFadeOut: () => void,
  onDismiss: () => void
): () => void {
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  const displayTimer = setTimeout(() => {
    onFadeOut();
    fadeTimer = setTimeout(onDismiss, SPEECH_BUBBLE_FADE_OUT_MS);
  }, getSpeechBubbleDisplayDuration(message));

  return (): void => {
    clearTimeout(displayTimer);
    if (fadeTimer !== undefined) clearTimeout(fadeTimer);
  };
}

export function dismissSpeechBubbleImmediately(
  onFadeOut: () => void,
  onDismiss?: () => void
): void {
  onFadeOut();
  onDismiss?.();
}

export function requestSpeechBubbleDismissOnce(
  gate: SpeechBubbleDismissGate,
  onDismissRequested: () => void
): boolean {
  if (gate.current) return false;

  gate.current = true;
  onDismissRequested();
  return true;
}

export function clearSpeechBubbleExitTimer(timerRef: SpeechBubbleTimerRef): void {
  if (timerRef.current === undefined) return;

  clearTimeout(timerRef.current);
  timerRef.current = undefined;
}

export function replaceSpeechBubbleExitTimer(
  timerRef: SpeechBubbleTimerRef,
  onElapsed: () => void
): void {
  clearSpeechBubbleExitTimer(timerRef);
  timerRef.current = setTimeout(() => {
    timerRef.current = undefined;
    onElapsed();
  }, SPEECH_BUBBLE_FADE_OUT_MS);
}

export function SpeechBubbleView({
  message,
  phase,
  onDismissRequested,
}: SpeechBubbleViewProps): React.ReactElement {
  const isThought = message.sender === 'thought';

  return (
    <div
      className={`wisp-speech-bubble speech-bubble ${isThought ? 'is-thought' : 'is-speech'} is-${phase}`}
      role="button"
      tabIndex={0}
      aria-label={isThought ? 'Dismiss thought' : 'Dismiss speech'}
      onClick={(event) => {
        event.stopPropagation();
        onDismissRequested();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          onDismissRequested();
        }
      }}
    >
      <div className="speech-content">
        {isThought ? <span className="thought-icon" aria-hidden="true">💭</span> : null}
        <span className="speech-text">{message.text}</span>
      </div>
      <div className="speech-bubble-arrow" aria-hidden="true" />
    </div>
  );
}

export const SpeechBubble: React.FC<SpeechBubbleProps> = ({ message, onDismiss }) => {
  const [displayedMessage, setDisplayedMessage] = useState<ChatMessage | null>(message);
  const [phase, setPhase] = useState<SpeechBubblePhase>(message ? 'entering' : 'exiting');
  const onDismissRef = useRef(onDismiss);
  const cancelAutoDismissRef = useRef<() => void>(() => undefined);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismissStartedRef = useRef(message === null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    cancelAutoDismissRef.current();
    if (enterTimerRef.current !== undefined) clearTimeout(enterTimerRef.current);
    clearSpeechBubbleExitTimer(exitTimerRef);

    if (message === null) {
      dismissStartedRef.current = true;
      setPhase('exiting');
      replaceSpeechBubbleExitTimer(exitTimerRef, () => setDisplayedMessage(null));
    } else {
      dismissStartedRef.current = false;
      setDisplayedMessage(message);
      setPhase('entering');
      enterTimerRef.current = setTimeout(() => {
        enterTimerRef.current = undefined;
        setPhase('visible');
      }, SPEECH_BUBBLE_ENTER_DELAY_MS);
      cancelAutoDismissRef.current = scheduleSpeechBubbleAutoDismiss(
        message,
        () => {
          dismissStartedRef.current = true;
          setPhase('exiting');
        },
        () => {
          setDisplayedMessage(null);
          onDismissRef.current?.();
        }
      );
    }

    return (): void => {
      cancelAutoDismissRef.current();
      if (enterTimerRef.current !== undefined) clearTimeout(enterTimerRef.current);
      clearSpeechBubbleExitTimer(exitTimerRef);
    };
  }, [message]);

  if (displayedMessage === null) return null;

  const dismissImmediately = (): void => {
    requestSpeechBubbleDismissOnce(dismissStartedRef, () => {
      cancelAutoDismissRef.current();
      if (enterTimerRef.current !== undefined) {
        clearTimeout(enterTimerRef.current);
        enterTimerRef.current = undefined;
      }
      dismissSpeechBubbleImmediately(() => setPhase('exiting'), onDismissRef.current);
      replaceSpeechBubbleExitTimer(exitTimerRef, () => setDisplayedMessage(null));
    });
  };

  return (
    <SpeechBubbleView
      message={displayedMessage}
      phase={phase}
      onDismissRequested={dismissImmediately}
    />
  );
};
