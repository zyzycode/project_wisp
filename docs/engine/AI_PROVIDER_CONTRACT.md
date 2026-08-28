# Контракт AI Provider

`IAIProvider` — boundary между desktop-клиентом Project Wisp и источником semantic responses. Provider отвечает за генерацию текстовых ответов и подсказок поведения, опираясь на богатый психологический контекст персонажа из `CHARACTER_ENGINE.md`, но не принимает финальные behavior decisions и не управляет UI.

Текущая default-реализация: `MockAIProvider`, полностью offline и локальная. Будущий `ExternalAIProviderClient` допускается только как client-side adapter к отдельному backend-проекту, не как backend/proxy/server code внутри `project_wisp`.

## Владение

- Интерфейс `IAIProvider` принадлежит Application layer и живет в `application/ports/`.
- Реализации provider-а принадлежат Infrastructure layer: текущий `MockAIProvider`, будущий `ExternalAIProviderClient`.
- Renderer, React components и Render Engine не знают конкретный provider и не получают provider-specific payload.
- Domain / Character Engine не видит raw provider DTO. Provider response проходит через `ProviderResponseIntentMapper` в Application layer.
- Application layer формирует `AIProviderRequest`, преобразуя доменное состояние `CharacterState` в сериализуемый снимок психологического контекста (`CharacterSnapshot`).

## Форма интерфейса

```typescript
export interface IAIProvider {
  getStatus(): Promise<AIProviderStatus>;
  generateResponse(request: AIProviderRequest): Promise<AIProviderResponse>;
}
```

- `getStatus()` нужен Application layer для debug/status counters и предсказуемого fallback. Он не должен инициировать network setup, login flow или user-facing provider configuration.
- `generateResponse()` возвращает один semantic response. Streaming допускается позже только как расширение этого контракта после Architect review.

## Request DTO

`AIProviderRequest` является сериализуемым DTO без ссылок на React, DOM, Electron window handles, Node objects или классы внешних SDK.

```typescript
export interface AIProviderRequest {
  requestId: string;
  userMessage: {
    id: string;
    text: string;
    createdAt: string;
  };
  /** Богатый срез психологического состояния из CHARACTER_ENGINE.md */
  characterSnapshot: CharacterSnapshot;
  recentContext: Array<{
    role: 'user' | 'wisp';
    text: string;
    createdAt: string;
  }>;
  locale?: string;
}

export interface CharacterSnapshot {
  /** Витальные потребности (unmet needs + energy) */
  needs: {
    energy: number;
    attention: number;
    play: number;
    comfort: number;
  };
  /** Уровень отношений с пользователем */
  relationship: {
    friendship: number;
    love: number;
    loveUnlocked: boolean;
  };
  /** Личность персонажа и концепция */
  personality: {
    presetId: string;
    aiSelfConcept: string;
    traits: {
      shyness: number;
      playfulness: number;
      sensitivity: number;
      boldness: number;
    };
  };
  /** Романтическое состояние и границы */
  intimacy: {
    flirtiness: number;
    romanticCharge: number;
    userConsentEnabled: boolean;
  };
  /** Синтезированный преобладающий эмоциональный тон */
  synthesizedTone: 'shy' | 'sleepy' | 'playful' | 'curious' | 'neutral' | 'affectionate' | 'flustered';
}
```

### Правила:
- `text` санитизируется на application/domain boundary.
- `characterSnapshot` собирается Application layer из `CharacterState` и является immutable DTO.
- `recentContext` ограничивается Application layer (скользящее окно); provider не получает полный SQLite dump без отдельного memory contract.
- DTO не содержит токены, названия внешних моделей, API keys, endpoint URLs или auth/billing поля.

## Response DTO

`AIProviderResponse` описывает semantic result provider-а. Он может предложить эмоциональный тон или suggested behavior, но не выбирает окончательное поведение персонажа, animation clip или ассет.

```typescript
export interface AIProviderResponse {
  requestId: string;
  status: 'ok' | 'fallback';
  reply: {
    text: string;
    tone?: 'warm' | 'playful' | 'sleepy' | 'curious' | 'confused' | 'quiet' | 'shy' | 'affectionate';
  };
  suggestedMood?: 'neutral' | 'happy' | 'curious' | 'sleepy' | 'confused' | 'shy' | 'affectionate';
  suggestedBehavior?: ProviderSuggestedBehaviorKind;
  confidence: number;
  diagnostics?: {
    provider: 'mock' | 'external';
    latencyMs: number;
    fallbackReason?: AIProviderFallbackReason;
  };
}

export type ProviderSuggestedBehaviorKind =
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

### Правила:
- `reply.text` — текст для отображения в SpeechBubble и передачи в историю диалога.
- `suggestedBehavior` — семантическая подсказка. `CharacterEngine` решает, допустимо ли действие с учетом `Needs`, `Relationship`, `cooldowns`, `quiet/sleep mode` и приоритета действий пользователя.
- First-party providers возвращают `suggestedBehavior` только из разрешенного подмножества `BehaviorIntentKind` (см. `BEHAVIOR_INTENTS.md`).
- Provider не должен предлагать `drag` или `land` (они принадлежат прямому user interaction). Если такие значения пришли, mapper отбрасывает их в fallback.
- Response не содержит CSS class names, React component names, SVG paths, sprite sheet names, frame indexes, animation fps или asset paths.

## Thinking и latency

Provider contract позволяет Application layer отображать thinking-состояние без знания конкретной реализации provider-а.

```text
idle -> thinking -> ok
idle -> thinking -> fallback
idle -> thinking -> error
```

```typescript
export interface AIProviderStatus {
  kind: 'ready' | 'thinking' | 'degraded' | 'offline' | 'error';
  activeRequestId?: string;
  message?: string;
}
```

### Правила:
- `MockAIProvider` симулирует latency локальным таймером, без сети.
- Thinking state provider-нейтрален: UI видит presentation-ready state через Application/IPC.
- Provider не должен блокировать прямой ввод пользователя (drag, click); приоритет прямого ввода всегда выше.

## Errors и offline fallback

```typescript
export type AIProviderFallbackReason =
  | 'empty_input'
  | 'message_too_long'
  | 'unsupported_input'
  | 'provider_unavailable'
  | 'timeout'
  | 'unexpected_error';
```

### Правила:
- Для MVP `MockAIProvider` возвращает локальные детерминированные fallback responses для пустого, слишком длинного или непонятного ввода.
- Offline fallback является штатным поведением: Project Wisp полностью работоспособен без интернета.
- Ошибки внешнего адаптера мапятся в нейтральные fallback/error states без утечки технической информации в UI.

## Реализации

### `MockAIProvider`
- Работает полностью локально и оффлайн.
- Возвращает локальные реплики с учетом `CharacterSnapshot` (отвечает стеснительно при высоком shyness, кратко при низкой энергии, теплее при высокой дружбе).
- Симулирует thinking/latency.
- Не делает сетевых вызовов и не требует API-ключей.

### `ExternalAIProviderClient`
- Будущий client-side адаптер к внешнему бэкенду.
- Не содержит backend/proxy/server кода внутри `project_wisp`.
- Не хранит пользовательские API-ключи внутри десктоп-клиента.
- Любое подключение требует отдельного Architect review.

## Запрещённые знания provider-а

Provider не знает и не выбирает:
- React components, Zustand stores, DOM nodes, CSS classes;
- SVG paths, sprite sheet files, asset paths, frame indexes;
- Electron window handles, IPC channels, platform details;
- SQLite schema, сырые таблицы БД или приватные системные настройки;
- Auth/billing/subscription серверную логику.

## Граница mapper-а

`ProviderResponseIntentMapper` (Application layer):
```text
AIProviderResponse -> ProviderResponseIntentMapper -> BehaviorIntent
```
- Переводит `AIProviderResponse` во внутренний `BehaviorIntent`.
- Не принимает финальных решений о поведении (решение принимает `CharacterEngine`).
- Нормализует подсказки provider-а и отбрасывает неизвестные значения в safe fallback.
