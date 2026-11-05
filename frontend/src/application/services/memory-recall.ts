import type { AIProviderMemoryContext, IGameEpisodeReader, ILocalMemoryRecall, MemoryRecallQuery, RecalledCausalEpisode } from '../ports/memory-knowledge.interface';
import type { CausalLifeEpisode } from '../ports/causal-life.interface';
import type { ICausalLifeRecallReader, CausalRecallPage } from '../ports/causal-recall.interface';
import type { IMemoryItemRecallReader, MemoryItemRecallPage } from '../ports/memory-items.interface';
import type { IChatHistoryRepository, IUserFactsRepository, MemoryFailureCode, MemoryOperationContext, MemoryResult } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import type { PreferenceTrack } from '../../domain/character/types';
import { parseMemoryFact, recognizeMemoryFact } from './memory-fact-registry';
import { causalRecallBucket, causalRecallBuckets, recallTokens } from '../../domain/character/causal-recall';

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
export function projectCausalEpisode(event: CausalLifeEpisode): RecalledCausalEpisode | null {
  if (event.cause === 'other' || event.cause === 'unknown') return null;
  return { kind: 'causal_event', activity: event.activity ?? 'contact', outcome: event.outcome ?? 'not_applicable', cause: event.cause,
    actor: event.source, participation: event.participation, executedMs: event.executedMs, occurredAt: event.occurredAt };
}
export class LocalMemoryRecall implements ILocalMemoryRecall {
  private reading = false;
  constructor(private readonly options: {
    readonly facts: IUserFactsRepository; readonly history: IChatHistoryRepository; readonly gameReader: IGameEpisodeReader;
    readonly beforeRead?: () => Promise<void>;
    readonly scheduler: MemoryScheduler; readonly isCurrent: (generation: number) => boolean;
    readonly preference: () => PreferenceTrack | undefined; readonly onFailure: (code: MemoryFailureCode) => void;
    readonly causalRecall?: ICausalLifeRecallReader; readonly itemRecall?: IMemoryItemRecallReader;
    readonly timestamp?: () => string;
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
      const [facts, history, games] = await Promise.all([safe(() => this.options.facts.list(100, context)), safe(() => this.options.history.getRecent(100, context)), safe(() => this.options.gameReader.getRecent(20, context))]);
      if (expired || !this.options.isCurrent(context.generation)) return undefined;
      const text = query.useFavoriteTopic && facts.ok ? facts.value.find(fact => fact.factKey === 'user.favorite_topic' && fact.confidence === 1 && fact.sourceMessageId)?.factValue ?? query.text : query.text;
      const current = query.causalSituation;
      const validCurrent = !current || current.source.appRunId === current.episode.appRunId && current.source.sequence === current.episode.sequence && current.source.revision === current.episode.revision;
      const key = current ? validCurrent ? causalRecallBuckets(current.episode).at(-1) ?? null : null : causalRecallBucket(text);
      const before = this.options.timestamp?.();
      const canRead = facts.ok && history.ok && games.ok;
      const [causal, items] = await Promise.all([
        canRead && key && before && this.options.causalRecall ? safe(() => this.options.causalRecall!.find({ key, before, ...(current ? { exclude: current.source } : {}) }, context))
          : Promise.resolve<MemoryResult<CausalRecallPage | null>>({ ok: true, value: null }),
        canRead && this.options.itemRecall ? safe(() => this.options.itemRecall!.find(recallTokens(text).filter(token => token.length <= 64), context))
          : Promise.resolve<MemoryResult<MemoryItemRecallPage>>({ ok: true, value: { candidates: [], coverage: 'complete', examined: 0, fetched: 0 } }),
      ]);
      return { text, results: [facts, history, games, causal, items] as const };
    })().finally(() => { this.reading = false; });
    // At most one unsettled read group: another turn does not grow a queue after timeout.
    const timeout = new Promise<undefined>(resolve => { timer = this.options.scheduler.setTimeout(() => { expired = true; resolve(undefined); }, 200); });
    try {
      const results = await Promise.race([reads, timeout]);
      if (!this.options.isCurrent(context.generation)) return { ok: false, code: 'stale' };
      if (!results) { this.options.onFailure('busy'); return { ok: false, code: 'busy' }; }
      const [facts, history, games, causal, items] = results.results;
      if (!facts.ok || !history.ok || !games.ok || !causal.ok || !items.ok) {
        const failure = results.results.find(result => !result.ok);
        const code = failure && !failure.ok ? failure.code : 'unavailable';
        this.options.onFailure(code); return { ok: false, code };
      }
      const selectedFacts = facts.value.flatMap(fact => {
        if (!fact.sourceMessageId || fact.confidence !== 1) return [];
        try { return [parseMemoryFact({ key: fact.factKey, value: fact.factValue })]; } catch { return []; }
      }).slice(0, 5);
      const queryTokens = tokens(results.text), excluded = new Set(query.excludedMessageIds);
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
      const causalEpisode = causal.value?.candidates[0] ? projectCausalEpisode(causal.value.candidates[0].episode) : null;
      // Cards participate in the local ranking; v1 does not permit their categories.
      // Filtering them here refills the same provider slots from the baseline pairs.
      const ranked = [...(items.value.coverage === 'complete' ? items.value.candidates.map(candidate => ({ kind: 'card' as const, candidate })) : []),
        ...pairs.map(pair => ({ kind: 'pair' as const, episode: pair.episode }))];
      const providerPairs = ranked.flatMap(candidate => candidate.kind === 'pair' ? [candidate.episode] : []);
      const episodes: AIProviderMemoryContext['episodes'][number][] = [
        ...(causalEpisode ? [causalEpisode] : game ? [{ kind: 'cursor_game' as const, outcome: game.outcome, executedMs: game.executedMs, occurredAt: game.endedAt }] : []),
        ...providerPairs.slice(0, causalEpisode || game ? 1 : 2),
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
