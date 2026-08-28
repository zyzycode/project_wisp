# Индекс engine contracts

`docs/engine/` является source of truth для engine contracts Project Wisp. Эти документы фиксируют границы между provider output, поведением персонажа, выбором анимации, рендером, памятью и настройками до начала implementation-задач.

Индекс намеренно короткий: детальные правила принадлежат отдельным contract-документам ниже.

## Реестр контрактов

| Документ | Статус | Назначение |
|---|---|---|
| [`AI_PROVIDER_CONTRACT.md`](./AI_PROVIDER_CONTRACT.md) | `ready` | Описывает `IAIProvider`, request/response DTO, передачу психологического контекста (`CharacterSnapshot`), thinking/latency/error states, offline fallback и будущий client-side contract к внешнему backend. |
| [`CHARACTER_ENGINE.md`](./CHARACTER_ENGINE.md) | `ready` | Описывает модель Wisp: потребности (`Needs`), отношения (`Relationship`: friendship, love), 7 осей личности (`PersonalityAxis`), романтическое напряжение (`IntimacyState`), вкусы, пресеты и динамический синтез эмоционального тона. |
| [`BEHAVIOR_INTENTS.md`](./BEHAVIOR_INTENTS.md) | `ready` | Описывает внутренние semantic `BehaviorIntent`: `respond`, `think`, `react_happy`, `react_confused`, `play`, `sleep`, `wake`, `drag`, `land`, `wander`, `idle`, `quiet`. Говорят, *что* Wisp пытается сделать, а не как это рисовать. |
| [`ANIMATION_ENGINE.md`](./ANIMATION_ENGINE.md) | `ready` | Описывает `AnimationIntent`, маппинг поведений в визуальные запросы, requested/default priority, interrupt rules, fallback behavior и `propHint`. Превращает принятое поведение в animation-ready intent. |
| `RENDER_ENGINE.md` | `planned` | Описывает renderer-facing visual contracts: render props, layers, SVG compatibility, sprite sheet layout, anchors, hitboxes, visual bounds, scale, theme, props и debug overlay expectations. |
| `MEMORY_ENGINE.md` | `planned` | Описывает local-only границы памяти: chat history, user facts, relationship state, ownership персистентности, privacy defaults и обязательное clear-memory behavior. |
| `SETTINGS_CONTRACT.md` | `planned` | Описывает ownership настроек и DTO для behavior, appearance, memory controls и debug options. |

## Владение контрактами

Engine contracts являются public architecture contracts репозитория. Implementer-агенты обязаны читать и соблюдать их, но не меняют `docs/engine/*`, IPC contracts, application ports или связанные public contract surfaces без Architect review.

Project Manager владеет статусами и sequencing задач в `.agents/tasks/README.md`; Architect владеет формой engine contracts и boundary decisions.

## Поток ответственности

```text
Входящий стимул / Сообщение / Таймер
  -> ProviderResponseIntentMapper (при наличии AI ответа)
  -> BehaviorIntent
  -> Character Engine (сверяет с Needs, Relationship, Personality, Cooldowns)
  -> Resolved BehaviorIntent
  -> AnimationIntent
  -> Animation Controller
  -> Render Engine
```

- **Provider DTO** принадлежит реализациям `IAIProvider`. Он передает реплику и suggested tone/behavior, опираясь на `CharacterSnapshot`, но не знает React, DOM, CSS, файлы ассетов или renderer state.
- **`ProviderResponseIntentMapper`** принадлежит Application layer. Он переводит provider-specific response DTO во внутренний `BehaviorIntent`.
- **`BehaviorIntent`** является domain/application handoff для семантического поведения.
- **Character Engine** принимает окончательные behavior decisions с учетом потребностей (`Needs`), отношений (`Relationship`), характера (`Personality`), романтического напряжения (`IntimacyState`) и режима тишины.
- **`AnimationIntent`** является семантическим визуальным запросом после принятого решения.
- **Animation Controller** управляет resolved animation state, timing, priority и interrupt rules.
- **Render Engine** только отображает presentation-ready visual state через SVG / sprite sheets.

## Граница Render Engine

Render Engine — не game engine. Он не решает поведение Wisp, не считает needs, не выбирает автономные действия, не применяет cooldowns, не интерпретирует provider payloads и не владеет memory/settings rules. Render Engine только отображает визуальные слои, кадры, пропсы, анкоры и хитбоксы.
