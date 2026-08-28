# Индекс engine contracts

`docs/engine/` является source of truth для engine contracts Project Wisp. Эти документы фиксируют границы между provider output, поведением персонажа, выбором анимации, рендером, памятью и настройками до начала implementation-задач.

Индекс намеренно короткий: детальные правила принадлежат отдельным contract-документам ниже.

## Планируемые документы

| Document | Responsibility |
|---|---|
| `AI_PROVIDER_CONTRACT.md` | Описывает `IAIProvider`, request/response DTO provider-а, thinking/latency/error states, offline fallback и будущий client-side contract к внешнему backend. Не требует реальных AI SDK, пользовательских API-ключей, proxy-кода или server implementation в `project_wisp`. |
| `CHARACTER_ENGINE.md` | Описывает модель Wisp: traits, mood, energy, focus, needs, quiet/sleep mode и влияние внутреннего состояния на behavior decisions. |
| `BEHAVIOR_INTENTS.md` | Описывает внутренние semantic `BehaviorIntent`: respond, think, react_happy, react_confused, play, sleep, wake, drag, land, wander, idle, quiet. Behavior intents говорят, что Wisp пытается сделать, а не как это рисовать. |
| `ANIMATION_ENGINE.md` | Описывает `AnimationIntent`, переходы animation state, requested/default priority metadata, interrupt rules, fallback behavior и clip-level expectations. Превращает принятое поведение в animation-ready intent. |
| `RENDER_ENGINE.md` | Описывает renderer-facing visual contracts: render props, layers, SVG compatibility, sprite sheet layout, anchors, hitboxes, visual bounds, scale, theme, props и debug overlay expectations. |
| `MEMORY_ENGINE.md` | Описывает local-only границы памяти: chat history, user facts, relationship state, ownership персистентности, privacy defaults и обязательное clear-memory behavior. |
| `SETTINGS_CONTRACT.md` | Описывает ownership настроек и DTO для behavior, appearance, memory controls и debug options. Main/Application владеет settings state; Renderer отображает и запрашивает изменения через typed boundaries. |

## Владение контрактами

Engine contracts являются public architecture contracts репозитория. Implementer-агенты обязаны читать и соблюдать их, но не меняют `docs/engine/*`, IPC contracts, application ports или связанные public contract surfaces без Architect review.

Project Manager владеет статусами и sequencing задач в `.agents/tasks/README.md`; Architect владеет формой engine contracts и boundary decisions.

## Поток ответственности

```text
provider DTO
  -> ProviderResponseIntentMapper
  -> BehaviorIntent
  -> Character Engine
  -> AnimationIntent
  -> Animation Controller
  -> Render Engine
```

- Provider DTO принадлежит реализациям `IAIProvider`. Он может предлагать semantic mood или behavior hints, но не знает React, DOM, CSS, asset files, sprite frames или renderer state.
- `ProviderResponseIntentMapper` принадлежит Application layer. Он переводит provider-specific response DTO во внутренний `BehaviorIntent` и не принимает финальные behavior decisions.
- `BehaviorIntent` является domain/application handoff для semantic behavior. Он называет намерение действия, а не animation clip или asset path.
- Character Engine владеет behavior decisions. Он применяет mood, energy, needs, quiet/sleep rules, cooldowns и приоритет user input.
- `AnimationIntent` является semantic visual request после принятого поведения: `idle_blink`, `thinking_loop`, `talking`, `happy_reaction`, `confused_reaction`, `sleep_start`, `sleep_loop`, `wake_up`, `dragged`, `land`, `walk` или `settle`.
- Animation Controller владеет resolved animation state, timing, priority и interrupt rules.
- Render Engine отображает presentation-ready visual state через SVG сейчас, sprite sheets следующим шагом и возможный rigging позже.

## Граница Render Engine

Render Engine — не game engine. Он не решает поведение Wisp, не считает needs, не выбирает autonomous actions, не применяет cooldowns, не интерпретирует provider payloads и не владеет memory/settings rules.

Render Engine только отображает уже принятое presentation state: visual layers, frames, props, anchors, hitboxes, bounds, scale, theme и debug visuals.
