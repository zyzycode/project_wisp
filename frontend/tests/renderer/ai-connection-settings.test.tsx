import { Children, isValidElement, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConnectionResultDTO, AIConnectionStatusDTO } from '../../src/shared/ipc-contracts';
import { AIConnectionSettings } from '../../src/renderer/components/Interaction/AIConnectionSettings';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[], index: 0,
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[], effectIndex: 0,
  pending: [] as (() => void)[],
}));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index] as T, (value: T) => { hooks.values[index] = value; }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index] as { current: T };
  },
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = hooks.effectIndex++, previous = hooks.effects[index];
    if (previous && deps.every((value, at) => Object.is(value, previous.deps[at]))) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      const cleanup = effect();
      hooks.effects[index] = { deps, ...(cleanup ? { cleanup } : {}) };
    });
  },
}));
beforeEach(() => {
  for (const effect of hooks.effects) effect.cleanup?.();
  hooks.values = []; hooks.index = 0; hooks.effects = []; hooks.effectIndex = 0; hooks.pending = [];
});

interface ElementProps {
  readonly children?: ReactNode;
  readonly onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  readonly onClick?: () => void;
  readonly onToggle?: (event: { readonly currentTarget: { readonly open: boolean } }) => void;
  readonly value?: string;
  readonly disabled?: boolean;
}
function element(tree: ReactNode, type: string, label?: string): ElementProps {
  let found: ElementProps | undefined;
  const visit = (children: ReactNode): void => {
    Children.forEach(children, child => {
      if (!isValidElement<ElementProps>(child)) return;
      if (child.type === type && (label === undefined || child.props.children === label)) found = child.props;
      else visit(child.props.children);
    });
  };
  visit(tree);
  if (!found) throw new Error(`Missing ${type} ${label ?? ''}`);
  return found;
}
function enter(tree: ReactNode, value: string): void {
  element(tree, 'input').onChange?.({ target: { value } } as ChangeEvent<HTMLInputElement>);
}
function submit(tree: ReactNode): void {
  element(tree, 'form').onSubmit?.({ preventDefault: vi.fn() } as FormEvent<HTMLFormElement>);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}
const OFFLINE: AIConnectionStatusDTO = {
  mode: 'offline', hasSavedKey: false, secureStorageAvailable: true, failure: null,
};
function fixture(status: AIConnectionStatusDTO = OFFLINE) {
  const bridge = {
    read: vi.fn(async (): Promise<AIConnectionStatusDTO> => status),
    configure: vi.fn(async (): Promise<AIConnectionResultDTO> => ({ ok: true, restartRequired: true })),
  };
  let open = true, streamId = 'stream-1';
  const render = () => {
    hooks.index = 0; hooks.effectIndex = 0;
    const tree = AIConnectionSettings({ bridge, streamId, open });
    for (const effect of hooks.pending.splice(0)) effect();
    return tree;
  };
  const ready = async () => { render(); await Promise.resolve(); return render(); };
  return { bridge, render, ready, setOpen: (next: boolean) => { open = next; }, setStream: (next: string) => { streamId = next; } };
}

describe('AI connection settings', () => {
  it('shows a masked set-only OpenAI form and explains data, cost and restart', async () => {
    const f = fixture({ ...OFFLINE, mode: 'ready', hasSavedKey: true });
    const tree = await f.ready(), markup = renderToStaticMarkup(tree);
    expect(markup).toContain('Подключение AI');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('разрешённая память Wisp передаются OpenAI');
    expect(markup).toContain('API может быть платным');
    expect(markup).toContain('не отправляет запрос в OpenAI');
    expect(markup).toContain('Работоспособность ключа ещё не проверена');
    expect(element(tree, 'input').value).toBe('');
    expect(element(tree, 'button', 'Сохранить и подключить').disabled).toBe(true);
    expect(f.bridge.configure).not.toHaveBeenCalled();
  });

  it('clears input on submission, blocks duplicate submits and waits for restart', async () => {
    const f = fixture(), pending = deferred<AIConnectionResultDTO>();
    f.bridge.configure.mockReturnValue(pending.promise);
    enter(await f.ready(), 'synthetic-openai-key');
    const form = f.render();
    submit(form); submit(form);
    expect(f.bridge.configure).toHaveBeenCalledExactlyOnceWith({ streamId: 'stream-1', kind: 'save', apiKey: 'synthetic-openai-key' });
    expect(element(f.render(), 'input').value).toBe('');
    expect(renderToStaticMarkup(f.render())).not.toContain('synthetic-openai-key');
    pending.resolve({ ok: true, restartRequired: true }); await Promise.resolve();
    expect(renderToStaticMarkup(f.render())).toContain('Перезапускаем Wisp для подключения. Память сохранится');
    submit(form);
    expect(f.bridge.configure).toHaveBeenCalledTimes(1);
  });

  it('removes a saved key explicitly and explains offline restart', async () => {
    const f = fixture({ ...OFFLINE, hasSavedKey: true });
    element(await f.ready(), 'button', 'Отключить').onClick?.();
    await Promise.resolve();
    expect(f.bridge.configure).toHaveBeenCalledExactlyOnceWith({ streamId: 'stream-1', kind: 'remove' });
    expect(renderToStaticMarkup(f.render())).toContain('Перезапускаем Wisp в офлайн-режиме. Память сохранится');
  });

  it('clears drafts when the section collapses, the menu closes or stream changes', async () => {
    const f = fixture();
    enter(await f.ready(), 'synthetic-key-one');
    element(f.render(), 'details').onToggle?.({ currentTarget: { open: false } });
    expect(element(f.render(), 'input').value).toBe('');
    enter(f.render(), 'synthetic-key-two');
    f.setOpen(false); expect(f.render()).toBeNull();
    f.setOpen(true);
    expect(element(await f.ready(), 'input').value).toBe('');
    enter(f.render(), 'synthetic-key-three');
    f.setStream('stream-2');
    expect(element(await f.ready(), 'input').value).toBe('');
    expect(f.bridge.configure).not.toHaveBeenCalled();
  });

  it('does not apply a save result from an earlier menu lifecycle', async () => {
    const f = fixture(), pending = deferred<AIConnectionResultDTO>();
    f.bridge.configure.mockReturnValue(pending.promise);
    enter(await f.ready(), 'synthetic-key'); submit(f.render());
    f.setOpen(false); f.render(); f.setOpen(true); await f.ready();
    pending.resolve({ ok: true, restartRequired: true }); await Promise.resolve();
    expect(renderToStaticMarkup(f.render())).not.toContain('Перезапускаем');
    expect(element(f.render(), 'input').value).toBe('');
  });

  it('does not apply a read result from the previous stream', async () => {
    const f = fixture(), pending = deferred<AIConnectionStatusDTO>();
    f.bridge.read.mockReturnValueOnce(pending.promise);
    f.render(); f.setStream('stream-2'); await f.ready();
    pending.resolve({ ...OFFLINE, mode: 'external' }); await Promise.resolve();
    expect(renderToStaticMarkup(f.render())).toContain('Офлайн-режим');
    expect(renderToStaticMarkup(f.render())).not.toContain('внешним сервером');
  });

  it('blocks saving without secure storage but permits removing a saved key', async () => {
    const f = fixture({ ...OFFLINE, hasSavedKey: true, secureStorageAvailable: false, failure: 'secure_storage_unavailable' });
    let tree = await f.ready();
    expect(element(tree, 'input').disabled).toBe(true);
    enter(tree, 'synthetic-key'); tree = f.render(); submit(tree);
    expect(f.bridge.configure).not.toHaveBeenCalled();
    element(tree, 'button', 'Отключить').onClick?.();
    expect(f.bridge.configure).toHaveBeenCalledExactlyOnceWith({ streamId: 'stream-1', kind: 'remove' });
  });

  it('does not offer personal-key mutations for an external backend', async () => {
    const f = fixture({ ...OFFLINE, mode: 'external' });
    const markup = renderToStaticMarkup(await f.ready());
    expect(markup).toContain('Подключение настроено через внешний сервер');
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain('Сохранить и подключить');
    expect(f.bridge.configure).not.toHaveBeenCalled();
  });

  it.each(['runtime_unavailable', 'startup_failed', 'startup_timeout', 'storage_error'] as const)('shows a safe %s status', async failure => {
    const f = fixture({ ...OFFLINE, mode: 'unavailable', failure });
    const markup = renderToStaticMarkup(await f.ready());
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain(failure);
  });

  it('clears a rejected key and never echoes exception details', async () => {
    const f = fixture();
    f.bridge.configure.mockRejectedValue(new Error('synthetic-secret /private/path'));
    enter(await f.ready(), 'synthetic-secret'); submit(f.render()); await Promise.resolve();
    const tree = f.render(), markup = renderToStaticMarkup(tree);
    expect(markup).toContain('Не удалось изменить подключение');
    expect(markup).not.toContain('synthetic-secret');
    expect(markup).not.toContain('/private/path');
    expect(element(tree, 'input').value).toBe('');
  });

  it('shows allowlisted mutation errors without retaining the entered key', async () => {
    const f = fixture();
    f.bridge.configure.mockResolvedValue({ ok: false, code: 'invalid_input' });
    enter(await f.ready(), 'synthetic-key'); submit(f.render()); await Promise.resolve();
    expect(renderToStaticMarkup(f.render())).toContain('Вставьте API-ключ OpenAI без пробелов внутри');
    expect(element(f.render(), 'input').value).toBe('');
  });

  it('does not display read failure details or offer a form before status loads', async () => {
    const f = fixture();
    f.bridge.read.mockRejectedValue(new Error('synthetic-secret /private/path'));
    await f.ready(); await Promise.resolve();
    const markup = renderToStaticMarkup(f.render());
    expect(markup).toContain('Не удалось открыть настройки подключения');
    expect(markup).not.toContain('synthetic-secret');
    expect(markup).not.toContain('type="password"');
  });
});
