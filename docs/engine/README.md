# Индекс engine contracts

`docs/engine/` является source of truth для engine contracts Project Wisp. Эти документы фиксируют границы между provider output, поведением персонажа, выбором анимации, рендером, памятью и настройками до начала implementation-задач.

Индекс намеренно короткий: детальные правила принадлежат отдельным contract-документам ниже.

## Реестр контрактов

| Документ | Статус | Назначение |
|---|---|---|
| [`AI_PROVIDER_CONTRACT.md`](./AI_PROVIDER_CONTRACT.md) | `ready` | Описывает `IAIProvider`, request/response DTO, передачу психологического контекста (`CharacterSnapshot`), thinking/latency/error states, offline fallback и будущий client-side contract к внешнему backend. |
| [`CHARACTER_ENGINE.md`](./CHARACTER_ENGINE.md) | `ready` | Описывает модель Wisp: потребности (`Needs`, включая `boredom`), отношения (`Relationship`: friendship, love), 7 осей личности (`PersonalityAxis`), романтическое напряжение (`IntimacyState`), вкусы, пресеты и динамический синтез эмоционального тона. |
| [`BEHAVIOR_INTENTS.md`](./BEHAVIOR_INTENTS.md) | `ready` | Описывает внутренние semantic `BehaviorIntent`: `respond`, `think`, `react_happy`, `react_confused`, `play`, `sleep`, `wake`, `drag`, `land`, `wander`, `idle`, `quiet`. Говорят, *что* Wisp пытается сделать, а не как это рисовать. |
| [`ANIMATION_ENGINE.md`](./ANIMATION_ENGINE.md) | `ready` | Описывает `AnimationIntent`, маппинг поведений в визуальные запросы, requested/default priority, interrupt rules, fallback behavior и `propHint`. Превращает принятое поведение в animation-ready intent. |
| [`RENDER_ENGINE.md`](./RENDER_ENGINE.md) | `ready` | Описывает renderer-facing visual contracts: схему `manifest.json`, универсальный формат кадров (PNG/Atlas), композицию слотов (`RenderSlot`), разделение с `AssetKind`, порт `ICharacterRenderer` и чистый DTO `RenderPresentationState`. |
| [`SHIMEJI_SPEC.md`](./SHIMEJI_SPEC.md) | `ready` | Описывает физику и автономию Shimeji: локомоцию (сидеть/лежать/бег/прыжки), баллистику броска курсором, слежение за мышью (gaze tracking), иерархические цепочки активностей и защиту от зацикливания (`RepetitionPenalty`). |
| [`MEMORY_ENGINE.md`](./MEMORY_ENGINE.md) | `ready` | Описывает local-only память: сообщения и сессии диалога, актуальные user facts, эпизодические memories, JSON snapshot состояния Wisp, Application ports, bounded AI context, privacy defaults и clear-memory behavior. |
| `SETTINGS_CONTRACT.md` | `planned` | Описывает ownership настроек и DTO для behavior, appearance, memory controls и debug options. |

## Владение контрактами

Engine contracts являются public architecture contracts репозитория. Implementer-агенты обязаны читать и соблюдать их, но не меняют `docs/engine/*`, IPC contracts, application ports или связанные public contract surfaces без Architect review.

Project Manager владеет статусами и sequencing задач в `.agents/tasks/README.md`; Architect владеет формой engine contracts и boundary decisions.
