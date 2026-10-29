import { describe, expect, it } from 'vitest';
import { recognizeChatMotion } from '../../src/application/services/chat-motion-recognition';

describe('recognizeChatMotion', () => {
  it.each([
    ['Иди влево', 'left'], ['пожалуйста, пройди немного налево', 'left'],
    ['можешь пойти вправо?', 'right'], ['Двигайся вправо, пожалуйста!', 'right'],
    ['please walk left', 'left'], ['can you move right?', 'right'],
    ['Could you please walk a little to the left?', 'left'], ['move to the right please.', 'right'],
    ['  ИДИ   ВЛЕВО!  ', 'left'],
  ])('recognizes the complete request %s', (text, direction) => {
    expect(recognizeChatMotion(text)).toEqual({ kind: 'command', command: { kind: 'move', direction } });
  });

  it.each(['Стой!', 'остановись', 'пожалуйста, остановись', 'можешь остановиться?', 'stop', 'please stop moving!', 'stand still', 'could you please stop?'])
    ('recognizes stop %s', text => {
      expect(recognizeChatMotion(text)).toEqual({ kind: 'command', command: { kind: 'stop' } });
    });

  it.each([
    'иди туда', 'иди влево или вправо', 'иди влево и прыгни', 'stop and jump',
    'can you move left or right?', 'иди влево. Потом прыгни', 'move the file left',
    'влево', 'иди влево на 1000 пикселей',
  ])('asks for clarification instead of partial execution: %s', text => {
    expect(recognizeChatMotion(text)).toEqual({ kind: 'clarify' });
  });

  it.each([
    '', 'привет', 'я сказала иди влево', 'что означает иди влево?',
    'переведи «иди влево»', 'Иди влево переводится как go left',
    'не иди влево', 'пожалуйста не иди влево', "don't move left", 'do not stop',
    'иди влево, но не вправо', '«иди влево»', '"stop"', "'walk left'", '`иди вправо`',
    'она попросила меня остановиться', 'можешь рассказать про движение влево?',
  ])('does not extract commands from conversation: %s', text => {
    expect(recognizeChatMotion(text)).toEqual({ kind: 'none' });
  });
});
