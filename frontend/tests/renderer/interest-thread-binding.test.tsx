import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { BrainStateDTO, InterestThreadApiBridge, MemoryCardListResultDTO } from '../../src/shared/ipc-contracts';
import { MemoryCards } from '../../src/renderer/components/Chat/MemoryCards';
import { ChatInput } from '../../src/renderer/components/Chat/ChatInput';
import { getInterestThreadClient } from '../../src/renderer/interest-thread-client';
import { getDialogueCommandClient } from '../../src/renderer/dialogue-command-client';
import { useDialogueLoop } from '../../src/renderer/hooks/useDialogueLoop';
const handlers = vi.hoisted(() => ({ select: undefined as (() => void) | undefined, submit: undefined as ((e: { preventDefault(): void }) => Promise<void>) | undefined }));
// SSR captures real rendered handlers; no DOM or additional renderer dependency is required.
vi.mock('react/jsx-runtime', async original => {
  const runtime = await original<typeof import('react/jsx-runtime')>();
  function capture(props: unknown) {
    if (!props || typeof props !== 'object') return;
    if ('children' in props && props.children === 'Ответить по теме' && 'onClick' in props && typeof props.onClick === 'function') handlers.select = props.onClick as () => void;
    if ('className' in props && props.className === 'chat-input-form' && 'onSubmit' in props && typeof props.onSubmit === 'function') handlers.submit = props.onSubmit as typeof handlers.submit;
  }
  return { ...runtime, jsx: (...args: Parameters<typeof runtime.jsx>) => { capture(args[1]); return runtime.jsx(...args); }, jsxs: (...args: Parameters<typeof runtime.jsxs>) => { capture(args[1]); return runtime.jsxs(...args); } };
});
vi.mock('react/jsx-dev-runtime', async original => {
  const runtime = await original<typeof import('react/jsx-dev-runtime')>();
  return { ...runtime, jsxDEV: (...args: Parameters<typeof runtime.jsxDEV>) => {
    const props = args[1];
    if (props && typeof props === 'object') {
      if ('children' in props && props.children === 'Ответить по теме' && 'onClick' in props && typeof props.onClick === 'function') handlers.select = props.onClick as () => void;
      if ('className' in props && props.className === 'chat-input-form' && 'onSubmit' in props && typeof props.onSubmit === 'function') handlers.submit = props.onSubmit as typeof handlers.submit;
    }
    return runtime.jsxDEV(...args);
  } };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: <T,>(initial: T) => [typeof initial === 'boolean' ? true : initial === '' ? 'его перенесли' : initial, vi.fn()] }));
it('selects through real Memory surface, shows binding at existing input and sends it through the same bridge', async () => {
  const ref = { threadId: 'topic', revision: 2 };
  const interestThread: InterestThreadApiBridge = { read: vi.fn(async () => ({ ok: true, generation: 0, value: { ref, state: 'unanswered', text: 'собеседование', confirmedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-27T00:00:00.000Z', attempted: true } })), mutate: vi.fn() };
  const bridge = { interestThread, postDialogueCommand: vi.fn(async () => ({ status: 'accepted' as const, conversationId: 'c' })), listMemoryCards: vi.fn(async (): Promise<MemoryCardListResultDTO> => ({ ok: true, generation: 0, items: [], nextCursor: null })), mutateMemoryCard: vi.fn() };
  const topicClient = getInterestThreadClient(interestThread); topicClient.acceptStream('s'); await topicClient.read();
  const snapshot = { streamId: 's', revision: 1, dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } } } as BrainStateDTO;
  getDialogueCommandClient(bridge).accept(snapshot);
  renderToStaticMarkup(<MemoryCards bridge={bridge} snapshot={snapshot} />);
  expect(handlers.select).toBeTypeOf('function'); handlers.select!();
  function ExistingInput() {
    const dialogue = useDialogueLoop({ bridge, snapshot, setCurrentMessage: vi.fn() });
    return <ChatInput isOpen canSubmit={dialogue.canSubmit} onSendMessage={dialogue.handleSendMessage} onClose={vi.fn()} replyTopic={dialogue.replyTopic} cancelTopic={dialogue.cancelTopic} />;
  }
  const markup = renderToStaticMarkup(<ExistingInput />);
  expect(markup).toContain('Ответ по теме: собеседование'); expect(markup).toContain('Отменить выбор темы');
  await handlers.submit!({ preventDefault() {} });
  expect(bridge.postDialogueCommand).toHaveBeenCalledWith(expect.objectContaining({ text: 'его перенесли', replyToInterestThread: ref }));
});
