import type { AIProviderMemoryContext, IGameEpisodeReader, ILocalMemoryRecall, MemoryRecallQuery } from '../ports/memory-knowledge.interface';
import type { IChatHistoryRepository, IUserFactsRepository, MemoryFailureCode, MemoryOperationContext, MemoryResult } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import type { PreferenceTrack } from '../../domain/character/types';
import { parseMemoryFact, recognizeMemoryFact } from './memory-fact-registry';

export const emptyMemoryContext = (): AIProviderMemoryContext => ({ facts: [], episodes: [], characterPreferences: [] });
export function memoryTextLength(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce<number>((sum, item: unknown) => sum + memoryTextLength(item), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce<number>((sum, item: unknown) => sum + memoryTextLength(item), 0);
  return 0;
}
function tokens(text: string): string[] { return [...new Set(text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])]; }
function truncate(text: string, limit: number): string {
  const end = /[\uD800-\uDBFF]/u.test(text.charAt(limit - 1)) ? limit - 1 : limit;
  return text.slice(0, end);
}
export class LocalMemoryRecall implements ILocalMemoryRecall {
  private reading = false;
  constructor(private readonly options: {
    readonly facts: IUserFactsRepository; readonly history: IChatHistoryRepository; readonly gameReader: IGameEpisodeReader;
    readonly beforeRead?: () => Promise<void>;
    readonly scheduler: MemoryScheduler; readonly isCurrent: (generation: number) => boolean;
    readonly preference: () => PreferenceTrack | undefined; readonly onFailure: (code: MemoryFailureCode) => void;
  }) {}
  async recall(query: MemoryRecallQuery, context: MemoryOperationContext): Promise<MemoryResult<AIProviderMemoryContext>> {
    if (this.reading || !this.options.isCurrent(context.generation)) return { ok: false, code: 'busy' };
    this.reading = true;
    let timer: unknown;
    let expired = false;
    const safe = async <T>(read: () => Promise<MemoryResult<T>>): Promise<MemoryResult<T>> => { try { return await read(); } catch { return { ok: false, code: 'unavailable' }; } };
    const reads = (async () => {
      await this.options.beforeRead?.();
      if (expired || !this.options.isCurrent(context.generation)) return undefined;
      return Promise.all([safe(() => this.options.facts.list(100, context)), safe(() => this.options.history.getRecent(100, context)), safe(() => this.options.gameReader.getRecent(20, context))]);
    })().finally(() => { this.reading = false; });
    // At most one unsettled read group: another turn does not grow a queue after timeout.
    const timeout = new Promise<undefined>(resolve => { timer = this.options.scheduler.setTimeout(() => { expired = true; resolve(undefined); }, 200); });
    try {
      const results = await Promise.race([reads, timeout]);
      if (!this.options.isCurrent(context.generation)) return { ok: false, code: 'stale' };
      if (!results) { this.options.onFailure('busy'); return { ok: false, code: 'busy' }; }
      const [facts, history, games] = results;
      if (!facts.ok || !history.ok || !games.ok) {
        const failure = results.find(result => !result.ok);
        const code = failure && !failure.ok ? failure.code : 'unavailable';
        this.options.onFailure(code); return { ok: false, code };
      }
      const selectedFacts = facts.value.flatMap(fact => {
        if (!fact.sourceMessageId || fact.confidence !== 1) return [];
        try { return [parseMemoryFact({ key: fact.factKey, value: fact.factValue })]; } catch { return []; }
      }).slice(0, 5);
      const queryTokens = tokens(query.useFavoriteTopic ? selectedFacts.find(fact => fact.key === 'user.favorite_topic')?.value ?? query.text : query.text), excluded = new Set(query.excludedMessageIds);
      const pairs: { score: number; position: number; episode: AIProviderMemoryContext['episodes'][number] }[] = [];
      for (let i = 0; i + 1 < history.value.length; i++) {
        const user = history.value[i]!, assistant = history.value[i + 1]!;
        if (user.role !== 'user' || assistant.role !== 'assistant' || user.conversationSessionId !== assistant.conversationSessionId
          || excluded.has(user.id) || excluded.has(assistant.id) || recognizeMemoryFact(user.content) || recognizeMemoryFact(assistant.content)
          || /^(?:Забудь|Forget|Сегодня будь|Today act as)(?:\s|$)/iu.test(user.content.trim()) || /^(?:Забудь|Forget|Сегодня будь|Today act as)(?:\s|$)/iu.test(assistant.content.trim())) continue;
        const pairTokens = new Set(tokens(`${user.content} ${assistant.content}`));
        const score = queryTokens.filter(token => pairTokens.has(token)).length;
        if (score > 0) pairs.push({ score, position: i, episode: { kind: 'dialogue', userText: truncate(user.content, 240), assistantText: truncate(assistant.content, 400), occurredAt: assistant.createdAt } });
      }
      pairs.sort((a, b) => b.score - a.score || b.position - a.position);
      const latestGame = queryTokens.some(token => /^(?:игр|курсор|пойм|промах|ловил|game|cursor|catch|caught|miss|play)/u.test(token)) ? games.value[0] : undefined;
      const game = latestGame && latestGame.executedMs <= 60_000 ? latestGame : undefined;
      const episodes: AIProviderMemoryContext['episodes'][number][] = [
        ...(game ? [{ kind: 'cursor_game' as const, outcome: game.outcome, executedMs: game.executedMs, occurredAt: game.endedAt }] : []),
        ...pairs.slice(0, game ? 1 : 2).map(pair => pair.episode),
      ];
      const preference = this.options.preference();
      const characterPreferences = preference && Number.isFinite(preference.value) && Math.abs(preference.value) <= 100 && preference.confidence >= 0.5 && preference.confidence <= 1
        ? [{ key: 'activity.cursor_game' as const, value: preference.value, confidence: preference.confidence }] : [];
      const value = { facts: selectedFacts, episodes, characterPreferences };
      while (memoryTextLength(value) > 2400 && episodes.length > 0) episodes.pop();
      return { ok: true, value };
    } catch {
      if (!this.options.isCurrent(context.generation)) return { ok: false, code: 'stale' };
      this.options.onFailure('unavailable'); return { ok: false, code: 'unavailable' };
    } finally { this.options.scheduler.clearTimeout(timer); }
  }
}
