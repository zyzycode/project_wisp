import type { ChatMotionRecognition } from '../ports/chat-motion';

const RU_VERB = '(?:иди|пойди|пройди|пройдись|двигайся|шагай)';
const RU_INFINITIVE = '(?:идти|пойти|пройти|пройтись|двигаться)';
const RU_PREFIX = `(?:(?:можешь|можно тебя попросить) (?:пожалуйста )?${RU_INFINITIVE}|${RU_VERB})`;
const RU_DIRECTION = '(влево|налево|вправо|направо)';
const EN_PREFIX = '(?:(?:can|could|would) you (?:please )?)?(?:go|walk|move)';
const EN_DIRECTION = '(?:to (?:the )?)?(left|right)';

const RU_MOVE = new RegExp(`^${RU_PREFIX} (?:(?:немного|чуть-чуть|чуть) )?${RU_DIRECTION}$`, 'u');
const EN_MOVE = new RegExp(`^${EN_PREFIX} (?:(?:a little|a bit) )?${EN_DIRECTION}$`, 'u');
const STOP = /^(?:стой|остановись|останови движение|можешь (?:пожалуйста )?остановиться|(?:(?:can|could|would) you (?:please )?)?(?:stop|stop moving|stand still))$/u;
const COMMAND_LIKE = new RegExp(`^(?:${RU_PREFIX}(?: |$)|${EN_PREFIX}(?: |$)|стой(?: |$)|остановись(?: |$)|останови(?: |$)|stop(?: |$)|stand still(?: |$)|(?:влево|налево|вправо|направо|left|right)$)`, 'u');

/** A deliberately bounded full-utterance grammar, never commands extracted from prose. */
export function recognizeChatMotion(text: string): ChatMotionRecognition {
  const lower = text.normalize('NFKC').toLowerCase().trim();
  // Quoted commands and negation belong to conversation rather than execution.
  if (/["«»„“”‘’`]/u.test(lower) || /(?:^|\s)'[^']*'(?:\s|$)/u.test(lower)
    || /(?:^|\s)(?:не|don't|dont|do not|never|переводится|означает|means)(?:\s|$)/u.test(lower)) return { kind: 'none' };
  const normalized = lower.replace(/[,]/gu, ' ').replace(/[.!?]+$/u, '').trim().replace(/\s+/gu, ' ')
    .replace(/^(?:пожалуйста|please) /u, '').replace(/ (?:пожалуйста|please)$/u, '');
  if (STOP.test(normalized)) return { kind: 'command', command: { kind: 'stop' } };
  const ru = RU_MOVE.exec(normalized);
  const en = EN_MOVE.exec(normalized);
  const direction = ru?.[1] ?? en?.[1];
  if (direction) return { kind: 'command', command: { kind: 'move',
    direction: ['влево', 'налево', 'left'].includes(direction) ? 'left' : 'right' } };
  return { kind: COMMAND_LIKE.test(normalized) ? 'clarify' : 'none' };
}
