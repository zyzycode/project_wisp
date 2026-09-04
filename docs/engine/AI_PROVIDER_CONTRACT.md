# Контракт AI Provider

`IAIProvider` — boundary между desktop-клиентом Project Wisp и источником semantic responses. Provider отвечает за генерацию текстовых ответов и подсказок поведения, опираясь на богатый психологический контекст персонажа из `CHARACTER_ENGINE.md`, но не принимает финальные behavior decisions и не управляет UI.

Текущая default-реализация: `MockAIProvider`, полностью offline и локальная. Будущий `ExternalAIProviderClient` допускается только как client-side adapter к отдельному backend-проекту, не как backend/proxy/server code внутри `project_wisp`.

## Владение

- Интерфейс `IAIProvider` принадлежит Application layer и живёт в `application/ports/`.
- Реализации provider-а принадлежат Infrastructure layer: текущий `MockAIProvider`, будущий `ExternalAIProviderClient`.
- Renderer, React components и Render Engine не знают конкретный provider и не получают provider-specific payload.
- Domain / Character Engine не видит raw provider DTO. Provider response проходит через `ProviderResponseIntentMapper` в Application layer.
- Application layer формирует `AIProviderRequest`, преобразуя доменное состояние `CharacterState` в сериализуемый снимок психологического контекста (`CharacterSnapshot`).

## Форма интерфейса

- `getStatus()` нужен Application layer для debug/status counters и предсказуемого fallback. Он не должен инициировать network setup, login flow или user-facing provider configuration.
- `generateResponse()` возвращает один semantic response. Streaming допускается позже только как расширение этого контракта после Architect review.

## Request DTO (Форма запроса)

Контракт IAIProvider, типы запроса/ответа и CharacterSnapshot определены в [src/application/ports/ai-provider.interface.ts](../../src/application/ports/ai-provider.interface.ts).

`AIProviderRequest` является сериализуемым DTO без ссылок на React, DOM, Electron window handles, Node objects или классы внешних SDK.

### Правила:
- `text` санитизируется на application/domain boundary.
- `characterSnapshot` собирается Application layer из `CharacterState` и является immutable DTO.
- `recentContext` ограничивается Application layer (скользящее окно); provider не получает полный SQLite dump без отдельного memory contract.
- DTO не содержит токены, названия внешних моделей, API keys, endpoint URLs или auth/billing поля.

## Response DTO (Форма ответа)

`AIProviderResponse` описывает semantic result provider-а. Он может предложить эмоциональный тон или suggested behavior, но не выбирает окончательное поведение персонажа, animation clip или ассет.

### Обязательные требования:
- `replyText` (`reply.text`) не пустой: текст для отображения в SpeechBubble и передачи в историю диалога.
- `suggestedBehavior` опционален: семантическая подсказка для `CharacterEngine`. `CharacterEngine` решает, допустимо ли действие с учетом `Needs`, `Relationship`, `cooldowns`, `quiet/sleep mode` и приоритета действий пользователя. First-party providers возвращают `suggestedBehavior` только из разрешенного подмножества `BehaviorIntentKind` (см. `BEHAVIOR_INTENTS.md`). Provider не должен предлагать `drag` или `land` (они принадлежат прямому user interaction; mapper отбрасывает их в fallback).
- `toneHint` (`reply.tone` / `suggestedTone`) валидируется через enum: допустимы только значения из словаря `SynthesizedEmotionalTone`. `CharacterEngine` остаётся источником истины и может проигнорировать provider hint.
- Response не содержит CSS class names, React component names, SVG paths, sprite sheet names, frame indexes, animation fps или asset paths.

## Thinking и latency

Provider contract позволяет Application layer отображать thinking-состояние без знания конкретной реализации provider-а.

```text
idle -> thinking -> ok
idle -> thinking -> fallback
idle -> thinking -> error
```

### Правила:
- `MockAIProvider` симулирует latency локальным таймером, без сети.
- Thinking state provider-нейтрален: UI видит presentation-ready state через Application/IPC.
- Provider не должен блокировать прямой ввод пользователя (drag, click); приоритет прямого ввода всегда выше.

## Errors и offline fallback

Причины fallback (`AIProviderFallbackReason`: `empty_input`, `message_too_long`, `unsupported_input`, `provider_unavailable`, `timeout`, `unexpected_error`) нормализуются в Application layer.

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

Provider следует [инвариантам изоляции Clean Architecture](./README.md#5-общие-архитектурные-границы-и-изоляция-clean-architecture) и не имеет доступа к UI-разметке (React/DOM/CSS), путям к ассетам/спрайтам, Electron/OS handles или таблицам SQLite.

## Граница mapper-а

`ProviderResponseIntentMapper` (Application layer):
```text
AIProviderResponse -> ProviderResponseIntentMapper -> BehaviorIntent
```
- Переводит `AIProviderResponse` во внутренний `BehaviorIntent`.
- Не принимает финальных решений о поведении (решение принимает `CharacterEngine`).
- Нормализует подсказки provider-а и отбрасывает неизвестные значения в safe fallback.
