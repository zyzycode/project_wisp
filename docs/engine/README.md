# Индекс engine contracts

Реестр принятых контрактов; статус реализации ведётся в GitHub Issues/Project. `UI_SPEC.md` принят в `DOC-A04`. Этот индекс помогает выбрать владельца правила, но не заменяет его спецификацию. Общие инженерные инварианты — в [AGENTS.md](../../AGENTS.md).

## 1. Реестр контрактов

Читайте разделы по задаче: сначала владение/границы, затем нужное правило и связанные типы в коде. Переходите к смежному контракту только при изменении или проверке соответствующего взаимодействия.

| Область | Канонический контракт | Что искать внутри |
|---|---|---|
| Character state, Needs, отношения, личность, tone | [CHARACTER_ENGINE.md](CHARACTER_ENGINE.md) | Владение; нужная модель/формула; sleep/wake и quiet gates |
| Публичные семантические намерения | [BEHAVIOR_INTENTS.md](BEHAVIOR_INTENTS.md) | Поток ответственности; форма intent; каталог; правила принятия |
| P0–P5, P4 Utility и cadence | [AUTONOMY_ENGINE.md](AUTONOMY_ENGINE.md) | Eligibility/scoring/arbitration; opportunity/order; safety и trace |
| Activity selection и execution | [ACTIVITY_ENGINE.md](ACTIVITY_ENGINE.md) | Lifecycle; guards; cancel/completion; cooldown/repetition; outcome |
| Physics, surfaces, позиция окна | [MOTION_ENGINE.md](MOTION_ENGINE.md) | Координаты; fixed step; collisions; support; authority; IPC |
| Gaze, cursor, окружение | [PERCEPTION_ENGINE.md](PERCEPTION_ENGINE.md) | Normalization; freshness/dwell; environment; privacy/capability |
| Визуальные намерения и клипы | [ANIMATION_ENGINE.md](ANIMATION_ENGINE.md) | Приоритеты; FSM; прерывания; sleep/wake presentation |
| Manifest, геометрия, слои, Skin | [RENDER_ENGINE.md](RENDER_ENGINE.md) | Skin contract; anchors/pivot; frame timing; fallback |
| UI/Renderer и Brain → Body | [UI_SPEC.md](UI_SPEC.md) | Ownership; typed IPC; revision/order/cadence; validation; cleanup/privacy |
| Локальная память | [MEMORY_ENGINE.md](MEMORY_ENGINE.md) | SQLite schema; порты; bounded context; restore/reset |
| AI-диалог | [AI_PROVIDER_CONTRACT.md](AI_PROVIDER_CONTRACT.md) | Request/response; runtime ownership; admission/deadline; fallback/reset; mapper |

<a id="4-матрица-межмодульных-контрактов-кто-от-кого-зависит"></a>

## 2. Канонические shared definitions

- Needs, tone, sleep/wake thresholds и quiet semantics принадлежат Character; Autonomy/Activity используют его snapshot/gates без собственных thresholds.
- Public `BehaviorIntent` shape/kinds принадлежат Behavior Intents; mapper, Autonomy и Activity не расширяют каталог локально.
- Utility policy/P0–P5 принадлежат Autonomy, исполняются Character; Activity выбирает и исполняет действие внутри resolved intent, не принимает решение за Character.
- Motion владеет physics/support/world position; Perception поставляет normalized observations без OS discovery в потребителях.
- `sleep`/`quiet`/`wake` — семантика Character; `sleep_start`/`sleep_loop`/`wake_up` — presentation lifecycle Animation. Render не принимает sleep/wake decisions.
- `BrainStateDTO`/`BodyEventDTO`, ordering и cadence принадлежат UI contract. Brain владеет state/timeline/motion; Body/Skin не подтверждают semantic progression.
- `ISkinEngine`/`SpriteSkinAdapter`, `BodyVisualState` и `RenderPresentationState` — renderer-local границы из Render contract. Skin types/resources не пересекают Shared IPC/Application/Domain; публичная граница — полный `BrainStateDTO`.

## 3. Граф зависимостей и поток данных между движками

```text
Boundary input → Application normalization → candidate BehaviorIntent
  → Character gating / P4 Utility → resolved BehaviorIntent
  → Activity selection/execution → AnimationIntent → BrainStateDTO
  → Body → Skin → presentation
BodyEventDTO (input/observation) → Application
Perception observations → Activity / Motion
Memory → Application → Character restore / bounded AI context
```

Application сериализует cadence и собирает snapshot; семантические решения остаются в Domain. Forced physical facts идут независимо через Motion: отменяют Activity и отражаются как `MotionEvent` в следующем цельном `BrainStateDTO`, без подтверждения Body/Skin. Voluntary locomotion из Activity также проходит через Motion. Полная ownership-матрица — в [Behavior Intents](BEHAVIOR_INTENTS.md#поток-ответственности).

<a id="5-общие-архитектурные-границы-и-изоляция-clean-architecture"></a>

## Общие границы

Clean Architecture, детерминизм Domain, нейтральность Application и изоляция Renderer обязательны для всех движков: [AGENTS.md §2–4](../../AGENTS.md#2-архитектура-и-контракты). Монотонное время и seeded RNG передаются явными входами; одинаковые входы дают одинаковый результат. Application нормализует входы и оркестрирует вызовы, не содержит SQL/UI и не принимает семантические решения за Domain.

## Справочные материалы

`*_VERIFICATION.md` — свидетельства конкретных проверок, `AUTO_A09_RESULT.md` — результат architect gate. Они не являются новыми engine contracts. Читайте их при связи с текущей Issue; связанные `Implementation consequences` обязательны для реализации. Формулы, FSM, defaults и схемы остаются в канонических спецификациях выше.
