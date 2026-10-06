import { renderToStaticMarkup } from 'react-dom/server';
import type { HTMLAttributes, KeyboardEvent, MouseEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../src/domain/chat/chat-message';
import {
  calculateSpeechBubbleDuration,
  getSpeechBubbleDisplayDuration,
  replaceSpeechBubbleExitTimer,
  requestSpeechBubbleDismissOnce,
  scheduleSpeechBubbleAutoDismiss,
  SPEECH_BUBBLE_FADE_OUT_MS,
  SpeechBubble,
  SpeechBubbleView,
} from '../../src/renderer/components/Chat/SpeechBubble';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'message-1',
    sender: 'pet',
    text: 'Привет!',
    timestamp: 1000,
    ...overrides,
  };
}

describe('Renderer: SpeechBubble', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('calculates adaptive reading duration within the 3–10 second bounds', () => {
    expect(calculateSpeechBubbleDuration('')).toBe(3000);
    expect(calculateSpeechBubbleDuration('Коротко')).toBe(3000);
    expect(calculateSpeechBubbleDuration('x'.repeat(20))).toBe(3400);
    expect(calculateSpeechBubbleDuration('x'.repeat(100))).toBe(7000);
    expect(calculateSpeechBubbleDuration('x'.repeat(1000))).toBe(10000);
  });

  it('executes click and keyboard handlers but dismisses only once during exit', () => {
    const onDismiss = vi.fn();
    const dismissGate = { current: false };
    const view = SpeechBubbleView({
      message: message(),
      phase: 'visible',
      onDismissRequested: () => requestSpeechBubbleDismissOnce(dismissGate, onDismiss),
    });
    const handlers = view.props as HTMLAttributes<HTMLDivElement>;
    const exitingHandlers = SpeechBubbleView({
      message: message(),
      phase: 'exiting',
      onDismissRequested: () => requestSpeechBubbleDismissOnce(dismissGate, onDismiss),
    }).props as HTMLAttributes<HTMLDivElement>;
    const clickEvent = { stopPropagation: vi.fn() } as unknown as MouseEvent<HTMLDivElement>;
    const enterEvent = {
      key: 'Enter',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent<HTMLDivElement>;
    const spaceEvent = {
      key: ' ',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent<HTMLDivElement>;

    handlers.onClick?.(clickEvent);
    exitingHandlers.onKeyDown?.(enterEvent);
    exitingHandlers.onKeyDown?.(spaceEvent);

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(clickEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(enterEvent.preventDefault).toHaveBeenCalledOnce();
    expect(enterEvent.stopPropagation).toHaveBeenCalledOnce();
    expect(spaceEvent.preventDefault).toHaveBeenCalledOnce();
    expect(spaceEvent.stopPropagation).toHaveBeenCalledOnce();
  });

  it('replaces an existing exit timer instead of leaving a stale callback', () => {
    const timerRef: { current: ReturnType<typeof setTimeout> | undefined } = {
      current: undefined,
    };
    const staleCallback = vi.fn();
    const latestCallback = vi.fn();

    replaceSpeechBubbleExitTimer(timerRef, staleCallback);
    replaceSpeechBubbleExitTimer(timerRef, latestCallback);
    vi.advanceTimersByTime(SPEECH_BUBBLE_FADE_OUT_MS);

    expect(staleCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledOnce();
    expect(timerRef.current).toBeUndefined();
  });

  it('prefers an explicit message duration over the calculated fallback', () => {
    expect(getSpeechBubbleDisplayDuration(message({ durationMs: 1234 }))).toBe(1234);
    expect(getSpeechBubbleDisplayDuration(message({ text: 'x'.repeat(100) }))).toBe(7000);
  });

  it('starts fade-out after reading time and dismisses after the exit transition', () => {
    const onFadeOut = vi.fn();
    const onDismiss = vi.fn();
    const cancel = scheduleSpeechBubbleAutoDismiss(
      message({ text: 'x'.repeat(100) }),
      onFadeOut,
      onDismiss
    );

    vi.advanceTimersByTime(6999);
    expect(onFadeOut).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFadeOut).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SPEECH_BUBBLE_FADE_OUT_MS);
    expect(onDismiss).toHaveBeenCalledOnce();

    cancel();
  });

  it('cancels both display and fade timers during cleanup', () => {
    const onFadeOut = vi.fn();
    const onDismiss = vi.fn();
    const cancelBeforeFade = scheduleSpeechBubbleAutoDismiss(message(), onFadeOut, onDismiss);
    cancelBeforeFade();
    vi.runAllTimers();
    expect(onFadeOut).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();

    const cancelDuringFade = scheduleSpeechBubbleAutoDismiss(message(), onFadeOut, onDismiss);
    vi.advanceTimersByTime(3000);
    expect(onFadeOut).toHaveBeenCalledOnce();
    cancelDuringFade();
    vi.runAllTimers();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('renders distinct speech and thought markup with a character-facing tail', () => {
    const speechMarkup = renderToStaticMarkup(<SpeechBubble message={message()} />);
    const thoughtMarkup = renderToStaticMarkup(
      <SpeechBubble message={message({ sender: 'thought', text: 'Интересно…' })} />
    );

    expect(speechMarkup).toContain('is-speech');
    expect(speechMarkup).toContain('speech-bubble-arrow');
    expect(speechMarkup).not.toContain('thought-icon');
    expect(thoughtMarkup).toContain('is-thought');
    expect(thoughtMarkup).toContain('thought-icon');
    expect(thoughtMarkup).toContain('💭');
  });

  it('renders nothing when no message exists', () => {
    expect(renderToStaticMarkup(<SpeechBubble message={null} />)).toBe('');
  });
});
