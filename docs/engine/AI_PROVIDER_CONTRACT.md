# Контракт AI Provider

`IAIProvider` — boundary между desktop-клиентом Project Wisp и источником semantic responses. Provider отвечает за текстовый ответ и provider-level подсказки, но не принимает финальные behavior decisions и не управляет UI.

Текущая default-реализация: `MockAIProvider`, полностью offline и локальная. Будущий `ExternalAIProviderClient` допускается только как client-side adapter к отдельному backend-проекту, не как backend/proxy/server code внутри `project_wisp`.

## Владение

- Интерфейс `IAIProvider` принадлежит Application layer и должен жить в `application/ports/`.
- Реализации provider-а принадлежат Infrastructure layer: текущий `MockAIProvider`, будущий `ExternalAIProviderClient`.
- Renderer, React components и Render Engine не знают конкретный provider и не получают provider-specific payload.
- Domain/Character Engine не видит raw provider DTO. Provider response проходит через `ProviderResponseIntentMapper` в Application layer.

## Форма интерфейса

Документ задаёт начальную форму контракта; точные TypeScript-типы вводятся implementation-задачей `P10-T01`.

```typescript
interface IAIProvider {
  getStatus(): Promise<AIProviderStatus>;
  generateResponse(request: AIProviderRequest): Promise<AIProviderResponse>;
}
```

`getStatus()` нужен Application layer для debug/status counters и предсказуемого fallback. Он не должен инициировать network setup, login flow или user-facing provider configuration.

`generateResponse()` возвращает один semantic response. Streaming можно добавить позже только как расширение этого контракта после Architect review.

## Request DTO

`AIProviderRequest` должен быть сериализуемым DTO без ссылок на React, DOM, Electron window handles, Node objects или классы внешних SDK.

Минимальная форма:

```typescript
type AIProviderRequest = {
  requestId: string;
  userMessage: {
    id: string;
    text: string;
    createdAt: string;
  };
  characterSnapshot: {
    mood: string;
    energy: number;
    activity: string;
    focus: string;
  };
  recentContext: Array<{
    role: 'user' | 'wisp';
    text: string;
    createdAt: string;
  }>;
  locale?: string;
};
```

Правила:

- `text` уже должен быть sanitized на application/domain boundary.
- `characterSnapshot` является кратким снимком состояния, а не mutable domain object.
- `recentContext` ограничивается Application layer; provider не получает полный SQLite dump или приватные memory facts без отдельного будущего memory contract.
- DTO не содержит токены, model names внешних LLM, API keys, endpoint URLs или billing/auth fields.

## Response DTO

`AIProviderResponse` описывает semantic result provider-а. Он может предложить настроение или behavior hint, но не выбирает окончательное поведение, animation clip или asset.

Минимальная форма:

```typescript
type AIProviderResponse = {
  requestId: string;
  status: 'ok' | 'fallback';
  reply: {
    text: string;
    tone?: 'warm' | 'playful' | 'sleepy' | 'curious' | 'confused' | 'quiet';
  };
  suggestedMood?: 'neutral' | 'happy' | 'curious' | 'sleepy' | 'confused' | 'shy';
  suggestedBehavior?: ProviderSuggestedBehaviorKind;
  confidence: number;
  diagnostics?: {
    provider: 'mock' | 'external';
    latencyMs: number;
    fallbackReason?: AIProviderFallbackReason;
  };
};
```

```typescript
type ProviderSuggestedBehaviorKind =
  | 'respond'
  | 'think'
  | 'react_happy'
  | 'react_confused'
  | 'play'
  | 'sleep'
  | 'wake'
  | 'wander'
  | 'idle'
  | 'quiet';
```

Правила:

- `reply.text` является текстом для дальнейшей обработки Application layer, а не прямой командой Renderer-у.
- `suggestedBehavior` остаётся подсказкой provider-а. Character Engine позже решает, допустимо ли действие с учётом priority, cooldowns, quiet/sleep mode, drag state, mood и energy.
- First-party providers должны отдавать `suggestedBehavior` как provider-allowed subset канонического `BehaviorIntentKind` из `BEHAVIOR_INTENTS.md`.
- Provider не должен предлагать `drag` или `land`: они принадлежат прямому user/system interaction flow. Если external payload всё же прислал такие значения, mapper обязан отбросить их в safe fallback.
- Response не содержит CSS class names, React component names, SVG paths, sprite sheet names, frame indexes, animation fps или asset paths.

## Thinking и latency

Provider contract должен позволять Application layer показать thinking-состояние без знания реализации provider-а.

Рекомендуемый lifecycle:

```text
idle -> thinking -> ok
idle -> thinking -> fallback
idle -> thinking -> error
```

`AIProviderStatus`:

```typescript
type AIProviderStatus = {
  kind: 'ready' | 'thinking' | 'degraded' | 'offline' | 'error';
  activeRequestId?: string;
  message?: string;
};
```

Правила:

- `MockAIProvider` может симулировать latency локальным timer-ом, без network.
- Thinking state должен быть provider-neutral: UI видит presentation-ready state через Application/IPC, а не raw provider status.
- Latency используется для UX и diagnostics, не для выбора animation frames.
- Provider не должен блокировать drag/click/user input; user-input priority принадлежит Character Engine/Application flow.

## Errors и offline fallback

Provider errors не должны ломать desktop companion loop. Application layer обязан иметь fallback path.

`AIProviderFallbackReason`:

```typescript
type AIProviderFallbackReason =
  | 'empty_input'
  | 'message_too_long'
  | 'unsupported_input'
  | 'provider_unavailable'
  | 'timeout'
  | 'unexpected_error';
```

Правила:

- Для MVP `MockAIProvider` должен уметь возвращать локальные fallback responses для пустого, слишком длинного или непонятного ввода.
- Offline fallback является штатным поведением, а не ошибкой продукта: Project Wisp должен оставаться usable без интернета.
- Ошибки external adapter-а в будущем мапятся в provider-neutral fallback/error states и не раскрывают пользователю детали внешнего LLM provider-а.
- Debug UI может показывать status/counters, но не приватные memory facts и не secrets.

## Реализации

### `MockAIProvider`

`MockAIProvider` — текущий default provider для desktop-first/offline-first MVP.

Он:

- работает полностью локально;
- возвращает deterministic или pseudo-random локальные реплики;
- симулирует thinking/latency;
- покрывает базовые категории: greeting, question, care, play, sleep, unknown/fallback;
- не делает network calls;
- не требует user setup, API keys, accounts, tokens или backend.

### `ExternalAIProviderClient`

`ExternalAIProviderClient` — только будущий client-side adapter к готовому backend-контракту из отдельного репозитория.

Он не создаётся в рамках Phase 9 contract tasks и не должен превращаться в:

- backend/proxy/server implementation;
- dev gateway;
- direct LLM HTTP client;
- wrapper над OpenAI/Anthropic/Gemini/OpenRouter SDK внутри desktop-клиента;
- место хранения пользовательских AI API-ключей;
- auth/billing implementation.

Любое появление external adapter-а требует отдельной Architect review задачи и должно сохранять `MockAIProvider` как default provider до явного продуктового решения.

## Запрещённые знания provider-а

Provider не знает и не выбирает:

- React components или Zustand stores;
- DOM nodes, CSS classes или layout;
- SVG paths, sprite sheet files, asset paths или frame indexes;
- animation fps, frame duration или render scale;
- Electron window handles, IPC channels или platform adapter details;
- SQLite schema, raw memory storage или settings persistence details;
- auth/billing/subscription server logic.

## Граница mapper-а

`ProviderResponseIntentMapper` — Application layer component, не отдельный архитектурный слой. Он существует только для перевода provider-level DTO во внутренний `BehaviorIntent`, понятный Domain/Application boundary.

Поток:

```text
AIProviderResponse -> ProviderResponseIntentMapper -> BehaviorIntent
```

Правила:

- Provider возвращает semantic DTO: `reply.text`, `suggestedMood`, `suggestedBehavior`, `confidence`, fallback/error diagnostics.
- Provider не возвращает готовое UI-поведение, React state, DOM commands, animation clips, asset names или render props.
- Mapper принимает raw `AIProviderResponse` и возвращает internal `BehaviorIntent` или safe fallback intent.
- Domain/Character Engine получает только `BehaviorIntent` и не зависит от структуры `AIProviderResponse`.
- Mapper не решает, будет ли Wisp реально выполнять действие. Финальное решение остаётся за Character Engine.

Mapper может:

- нормализовать provider hints в известные internal intent names;
- отбросить неизвестные или unsafe suggested values;
- применить простую таблицу provider semantics, например `react_happy -> react_happy`, `react_confused -> react_confused`, `play -> play`, legacy/external raw `react + suggestedMood: happy/confused -> react_happy/react_confused`;
- превратить provider fallback/error в нейтральный fallback `BehaviorIntent`;
- приложить sanitized reply text и provider-neutral metadata, нужные Application layer;
- сохранить `requestId` для tracing/debug counters.

Mapper обязан оставить Character Engine:

- приоритет user input, drag/click interrupts и emergency transitions;
- cooldowns, no-spam rules, quiet/sleep mode и wake/sleep разрешения;
- влияние mood, energy, needs, focus и relationship state на поведение;
- выбор автономного действия, если provider hint отсутствует или конфликтует с состоянием Wisp;
- перевод принятого поведения в `AnimationIntent`.

Детальный каталог `BehaviorIntent` и `AnimationIntent` относится к `P09-T04`; этот документ фиксирует только provider-to-behavior boundary.
