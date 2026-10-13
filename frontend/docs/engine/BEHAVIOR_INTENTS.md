# Контракт BehaviorIntent

Внутреннее semantic намерение: что сделать, не React/DOM/CSS, sprite/SVG/clip/frame/render props. Изменение семантики контракта требует Architect review.

## Поток ответственности

Source hint/user/timer/system → Application mapper → candidate → Character → resolved BehaviorIntent → Behavior Brain (Activity-backed) → Runner → AnimationIntent → Controller. Forced fact идёт отдельно через MotionEvent в тот же Controller. Candidate/Resolved — стадии одной public формы, не новые DTO/kinds.

| Этап | Единственный authoritative owner | Результат и граница |
|---|---|---|
| Suggested intent | Источник; provider только предлагает hint | Hint не является решением и не обходит локальные правила. |
| Нормализация | Application mapper, включая `ProviderResponseIntentMapper` | Создаёт candidate `BehaviorIntent` из boundary DTO/event; не принимает behavior decision. |
| Gating / acceptance | Character Engine | Применяет `Needs`, `Relationship`, `Personality`, cooldowns, quiet/sleep и приоритет источника; для P4 opportunity сравнивает нормализованный candidate set через Utility policy; принимает, отклоняет или откладывает candidate. |
| Resolved behavior | Character Engine | Принятый `BehaviorIntent` становится единственным semantic решением. |
| Activity selection | Behavior Brain | Для Activity-backed behavior выбирает eligible Activity в рамках resolved `kind`; не переопределяет и не повторно принимает behavior decision. |
| Activity lifecycle | Activity Runner | Исполняет одну Activity, выпускает её `AnimationIntent` и voluntary locomotion command; не выбирает behavior или физический исход. |
| Forced motion | Motion Engine | Владеет позицией при drag/fall/collision/landing и выдаёт `MotionEvent`; не создаёт resolved behavior. |
| Visual intent | Activity Runner | Выпускает `AnimationIntent` по mapping contract; Animation Controller разрешает visual priority/interrupt/FSM, но не behavior. |

Forced facts — safety, не второй behavior arbiter. Они сразу отменяют Activity; в той же Application transaction valid drag input/landed нормализуется в обязательный lifecycle intent drag/land. Character разрешает semantic часть, но не отменяет P1/P0 физический факт. Support loss/collision без public kind остаются MotionEvent, каталог не расширяют.

[Position authority](MOTION_ENGINE.md#8-авторитет-позиции-кто-двигает-окно), [safety](AUTONOMY_ENGINE.md#3-safety-order-p0p5), [visual mapping](ANIMATION_ENGINE.md#1-поток-ответственности-brain--body--skin).

## Форма intent

[behavior-intent.ts](../../src/domain/behavior/behavior-intent.ts): BehaviorIntent/BehaviorIntentKind.

| Поле | Назначение |
|---|---|
| `kind` | Семантический тип намерения (`BehaviorIntentKind`) |
| `source` | Источник происхождения намерения (`user`, `provider`, `timer`, `memory`, `system`) |
| `priority` | Входная подсказка приоритета (`low`, `normal`, `high`, `critical`) |
| `replyText` | Опциональный текст ответа персонажа |
| `toneHint` | Опциональная тональность или эмоциональная подсказка |
| `reason` | Опциональное пояснение причины формирования намерения |

Priority — входная подсказка: Character может повысить/понизить/reject/defer, но не отменить уже случившийся P0 fact. Utility получает finite normal candidate set от Application, возвращает максимум один resolved; provider/timer/autonomy проходят общую boundary, provider не второй decision-maker.

## Начальный каталог

Канонические kinds ниже. Generic `react` запрещён: конкретные `react_happy`, `react_confused`, будущие `react_*`. Play — полноценный игровой/дружелюбный intent.

| `kind` | Ответственность | Типичные источники |
|---|---|---|
| `respond` | Ответить пользователю текстом и перейти в talking/reply behavior. | provider, user |
| `think` | Показать, что Wisp обрабатывает сообщение или задумался. | provider, user, timer |
| `react_happy` | Семантическая позитивная реакция на пользователя или событие. | provider, user |
| `react_confused` | Семантическая реакция непонимания, ошибки или неоднозначного ввода. | provider, user, system |
| `play` | Игровое или дружелюбное взаимодействие без выбора конкретной анимации или prop asset. | provider, user, timer |
| `sleep` | Перейти в semantic sleep, если Character Engine разрешит; quiet не меняется. | user, provider, timer |
| `wake` | Выйти из semantic sleep, если правила разрешают; quiet не меняется. | user, system |
| `drag` | Зафиксировать прямое перетаскивание пользователем. | user |
| `land` | Завершить drag movement и стабилизировать персонажа. | user, system |
| `wander` | Ненавязчивое автономное перемещение. | timer |
| `idle` | Стабильное спокойное поведение без активной цели. | timer, system |
| `quiet` | Подавить навязчивые автономные действия и реплики. | user, settings, system |

## Обязательные сценарии

| Сценарий | BehaviorIntent | Что остаётся вне intent |
|---|---|---|
| Chat reply | `respond` с `replyText` и optional `toneHint` | Конкретный speech bubble layout, animation clip, duration |
| Thinking | `think` | Визуальный loop, frames, spinner/face details |
| Happy reaction | `react_happy` | Выбор happy animation clip или SVG expression |
| Confused reaction | `react_confused` | Выбор confused animation clip или fallback face |
| Play | `play` | Игровая animation sequence, prop asset или конкретный сценарий |
| Sleep | `sleep` | Pillow asset path, sleep frames, exact pose |
| Wake up | `wake` | Wake animation frames и timing |
| Drag | `drag` с `priority: 'critical'` | Window movement math и dragged animation frames |
| Landing | `land` | Landing clip, easing, exact frame sequence |
| Wander | `wander` | Координаты перемещения, тайминги движения |
| Idle | `idle` | Конкретный микромоушн idle |
| Quiet | `quiet` | Режим окна, подавление фоновых таймеров |

## Правила принятия

User drag/click/input приоритетнее provider/timer. Active user interaction может отклонить sleep. Quiet может отклонить respond; хранение ответа для позднего показа требует отдельного решения. Safe dialogue presentation quiet не меняет.

Provider hints не обходят cooldown/no-spam/sleep/quiet; unknown hints не становятся priority behavior. Provider-origin drag/land запрещены: это user/system flow.

## Архитектурные границы

AUTO-A09 сохраняет kinds: calm→idle, Explore→wander, игра/bounded cursor interest/nonverbal SocialBid — Activities внутри play. Quiet — устойчивый user/settings mode, не поза и не выключение Needs clock.

Provider source не P1; допустимый provider выше local по [Autonomy §12](AUTONOMY_ENGINE.md#12-auto-a09-admission-и-владение-ai-занятием). Request/admission/start/terminal/ownership — отдельный [behavior-admission-port.ts](../../src/application/ports/behavior-admission-port.ts), без расширения provider DTO и asset/target fields BehaviorIntent. Reason — диагностика, не transport pose/gait/ownership/family.

DTO остаётся pure Domain, без UI/assets/frames/FPS/OS descriptors/IPC channels; [общая изоляция](README.md#5-общие-архитектурные-границы-и-изоляция-clean-architecture).
