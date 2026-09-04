# Каталог сценариев поведения

`docs/behaviors/` — неканонический каталог end-to-end сценариев Wisp. Он объясняет, как пользовательское ожидание проходит через несколько движков, но не определяет архитектурную семантику.

Единственные источники DTO, thresholds, scoring coefficients, behavior priorities и lifecycle transitions находятся в [`docs/engine/`](../engine/README.md). При расхождении всегда действует профильный engine contract. Изменение pack не меняет runtime contract и не разрешает новый intent, Activity, IPC или tuning value.

## Packs

| Pack | Пользовательский сценарий | Основные владельцы |
|---|---|---|
| [`VITAL.md`](./VITAL.md) | Сон, пробуждение, отдых и потребность в комфорте | Character → Autonomy → Activity → Animation; Motion для forced interruption |
| [`EXPLORATION.md`](./EXPLORATION.md) | Idle, wander, Explore и Zoomies | Autonomy → Activity → Perception/Motion → Animation |
| [`INTERACTION.md`](./INTERACTION.md) | Click, pet, drag и игра с курсором | Application input → Character/Perception/Motion → Activity → Animation |
| [`SOCIAL.md`](./SOCIAL.md) | Attention, SocialBid, dialogue и optional provider/LLM candidate | Character → Application mapper → Autonomy/Activity → Animation |

Это полный каталог текущей задачи: новые файлы для отдельных жестов и мелких действий не создаются.

## Как читать packs

- `Пользовательская цель` описывает наблюдаемый результат, а не технический контракт.
- `End-to-end flow` связывает каждый технический шаг с его authoritative engine owner.
- `Варианты` используют только существующие semantic intents и Activity concepts; точная eligibility остаётся в профильных contracts.
- `Graceful degradation` описывает безопасный исход без создания альтернативного decision-maker.
- `Acceptance scenarios` проверяют сквозное поведение без закрепления локальных thresholds, формул, кадров или таймингов.

Общая цепочка и ownership сверяются по [engine index](../engine/README.md#3-граф-зависимостей-и-поток-данных-между-движками). Public semantic catalog принадлежит [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#начальный-каталог), Character state и gates — [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md), arbitration — [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md), Activity execution — [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md), position — [`MOTION_ENGINE.md`](../engine/MOTION_ENGINE.md), observations — [`PERCEPTION_ENGINE.md`](../engine/PERCEPTION_ENGINE.md), visual lifecycle — [`ANIMATION_ENGINE.md`](../engine/ANIMATION_ENGINE.md).

## Запрещённое дублирование

Packs не содержат и не вводят:

- TypeScript definitions, public DTO, ports или IPC shapes;
- числовые thresholds, cooldown durations или scoring formulas;
- локальную таблицу behavior либо animation priorities;
- собственные eligibility, interruption, completion или fallback transitions;
- asset names, frames и Renderer implementation.

Ссылка из pack означает «применить действующий contract», а не скопировать его правило в этот каталог.

Outcome упоминается как Character feedback только там, где действующий [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#13-feedback-boundary) уже задаёт mapping. Отсутствие такого mapping не разрешает pack изобрести новый stimulus.
