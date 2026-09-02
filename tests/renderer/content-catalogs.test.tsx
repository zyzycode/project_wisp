import { describe, expect, it } from 'vitest';
import {
  CLICK_REPLIES,
  CLICK_REPLY_FALLBACK,
  FACE_PREVIEW_DEFAULT_REPLY,
  FACE_PREVIEW_FALLBACK_PREFIX,
  FACE_PREVIEW_REPLIES,
  INTERACTION_REPLIES,
} from '../../src/renderer/content/interaction-replies';
import {
  THOUGHT_FALLBACK,
  THOUGHTS,
} from '../../src/renderer/content/thoughts';

describe('Renderer: content catalogs', () => {
  it('exports non-empty readonly selection pools and their fallbacks', () => {
    const clickReplies: readonly string[] = CLICK_REPLIES;
    const thoughts: readonly string[] = THOUGHTS;

    expect(clickReplies).toHaveLength(4);
    expect(thoughts).toHaveLength(4);
    expect(CLICK_REPLY_FALLBACK).toBe('Мурр!');
    expect(THOUGHT_FALLBACK).toBe('Хм-м... 🤔');
  });

  it('keeps stable interaction-reply key coverage', () => {
    expect(Object.keys(INTERACTION_REPLIES)).toEqual([
      'welcome',
      'wakeFromClick',
      'wake',
      'sleep',
      'pet',
      'play',
      'feed',
      'think',
      'spook',
      'wave',
      'celebrate',
      'bored',
    ]);
  });

  it('keeps stable face-preview key coverage and fallback values', () => {
    expect(Object.keys(FACE_PREVIEW_REPLIES)).toEqual([
      'happy',
      'sad',
      'shocked',
      'sleepy',
      'talking',
      'thinking',
      'angry',
    ]);
    expect(FACE_PREVIEW_FALLBACK_PREFIX).toBe('Выражение: ');
    expect(FACE_PREVIEW_DEFAULT_REPLY).toBe('Обычное выражение ✨');
  });
});
