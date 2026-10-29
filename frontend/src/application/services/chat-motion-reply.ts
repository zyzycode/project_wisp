import type { ChatMotionCommand, ChatMotionReceipt, ChatMotionTerminal } from '../ports/chat-motion';

export function chatMotionReply(receipt: ChatMotionReceipt, command: ChatMotionCommand, en: boolean): string {
  if (receipt.status === 'started') return en ? `Walking ${command.kind === 'move' ? command.direction : 'left'}.` : `Иду ${command.kind === 'move' && command.direction === 'right' ? 'вправо' : 'влево'}.`;
  if (receipt.status === 'stopped') return receipt.hadActiveRun ? en ? 'Stopped.' : 'Остановилась.' : en ? 'I am not following a movement request.' : 'Сейчас я не выполняю просьбу о движении.';
  const replies = {
    sleeping: ['Я сплю. Прогулка подождёт.', 'I am sleeping. Walking can wait.'],
    low_energy: ['Я устала, мне нужно отдохнуть.', 'I am tired and need to rest.'],
    overloaded: ['Мне сейчас некомфортно. Сначала отдохну.', 'I feel overwhelmed. I need to rest first.'],
    forced_motion: ['Сейчас не могу идти: сначала нужно закончить текущее движение.', 'I cannot walk until the current movement finishes.'],
    unavailable: ['Сейчас движение недоступно.', 'Movement is unavailable right now.'],
    no_support: ['Сейчас нет подходящей опоры для прогулки.', 'There is no suitable support for walking right now.'],
    edge: ['В эту сторону дальше идти некуда.', 'There is no room to walk that way.'],
    invalid_request: ['Не поняла направление. Влево, вправо или остановиться?', 'Should I walk left, right, or stop?'],
  } as const;
  return replies[receipt.reason][en ? 1 : 0];
}

export function chatMotionTerminalReply(event: ChatMotionTerminal, en: boolean): string {
  if (event.status === 'completed') return en ? 'Finished walking.' : 'Закончила прогулку.';
  if (event.reason === 'critical_need') return en ? 'I stopped to rest.' : 'Остановилась: мне нужно отдохнуть.';
  return en ? 'The movement request was cancelled.' : 'Просьба о движении отменена.';
}
