# Контракт AnimationIntent

`AnimationIntent` — semantic visual request после принятого поведения. Он описывает, какое визуальное состояние нужно показать, но не описывает concrete sprite file, frame index, render geometry, rows/columns, asset path, renderer component или platform API.

Документ является source of truth для Animation Engine. Implementer-агенты не меняют этот contract без Architect review.

## Поток ответственности

```text
Application mapper
  -> Candidate BehaviorIntent
  -> Character Engine
  -> Resolved BehaviorIntent
  -> Behavior Brain (для Activity-backed behavior)
  -> Activity Runner
  -> AnimationIntent
  -> Animation Controller
  -> Asset/Fallback Resolver
  -> AnimationPlayer
  -> RenderPresentationState
  -> ICharacterRenderer

Forced physical fact -> Motion Engine -> MotionEvent -> same Animation Controller
```

- Application mapper создаёт candidate `BehaviorIntent`, но не принимает behavior decision.
- Character Engine принимает, отклоняет или откладывает candidate с учетом `Needs`, `Relationship`, `Personality`, `IntimacyState` и текущего `SynthesizedEmotionalTone`; принятый intent является resolved behavior.
- Behavior Brain выбирает Activity только в рамках resolved behavior, а Activity Runner выпускает semantic `AnimationIntent` по mapping contract этого документа.
- Animation Controller применяет resolved priority, interrupt rules, loop policy и координирует переходы стейт-машины.
- Asset/Fallback Resolver разрешает семантический fallback и сопоставляет intent с конкретными клипами и оверлеями из манифеста.
- AnimationPlayer управляет тактовой частотой (delta timing, currentFrame) и формирует `RenderPresentationState`.
- ICharacterRenderer детерминированно отрисовывает подготовленный `RenderPresentationState` через активный адаптер (например, `ReactSpriteRenderer`).

Animation Engine не принимает решений о поведении персонажа и не читает raw provider DTO. Activity Runner получает resolved `BehaviorIntent`, выбранную Activity и актуальный эмоциональный тон через Application boundary. Forced `MotionEvent` обходит Activity selection, потому что фиксирует физический факт, но входит в тот же Animation Controller и не создаёт второй behavior decision. Каноническое распределение владельцев определено в [`BEHAVIOR_INTENTS.md`](./BEHAVIOR_INTENTS.md#поток-ответственности).

### MotionEvent boundary

Forced motion использует тот же Animation Controller. Эти states разрешаются из `MotionEvent` и не становятся вторым `BehaviorIntent`:

| Motion event | FSM request/state | Visual policy |
|---|---|---|
| `drag_started` | `START_DRAG` / `dragged` | `critical`, non-interruptible |
| `airborne_started: throw_release/support_lost/voluntary_jump` | `RELEASE_DRAG` или `FALL` → `fall` | resolved не ниже `high` |
| `landed: soft_landing` | `LAND` / `land` → `settle` | `high` |
| `landed: stumble` | `stumble` → `settle` | `high`, bounded |
| `landed: crash_landing` | `crash_landing` → `recover` → `settle` | `high`, bounded |

`falling`/`fall` и `landing`/`land` — compatibility aliases на Controller boundary. `stumble`, `crash_landing` и `recover` — motion-resolved visual kinds/states того же FSM, а не public behavior kinds. Combined states наподобие `walk_look_left` запрещены.

Physical position authority и момент возврата voluntary locomotion определены в [`MOTION_ENGINE.md`](./MOTION_ENGINE.md#8-forced-motion-и-position-authority); Animation FSM не владеет world position.

## Форма intent

`SynthesizedEmotionalTone` используется ровно в форме, определённой в authoritative разделе [`CHARACTER_ENGINE.md`](./CHARACTER_ENGINE.md#8-эмоциональный-тон-синтез-настроения); Animation Engine не расширяет и не переопределяет его словарь.

```typescript
export interface AnimationIntent {
  kind: AnimationIntentKind;
  category: AnimationIntentCategory;
  priority: AnimationPriority;
  interrupt: AnimationInterruptMode;
  loop: AnimationLoopMode;
  requestedBy: BehaviorIntentKind | 'system';
  emotionalTone: SynthesizedEmotionalTone;
  expressionHint?: AnimationExpressionHint;
  propHint?: AnimationPropHint;
}

export type AnimationIntentKind =
  | 'idle_blink'
  | 'thinking_loop'
  | 'talking'
  | 'happy_reaction'
  | 'confused_reaction'
  | 'sleep_start'
  | 'sleep_loop'
  | 'wake_up'
  | 'dragged'
  | 'spook'
  | 'land'
  | 'walk'
  | 'settle';

export type AnimationIntentCategory =
  | 'idle'
  | 'reaction'
  | 'movement'
  | 'dialogue'
  | 'sleep'
  | 'transition';

export type AnimationPriority = 'low' | 'normal' | 'high' | 'critical';
export type AnimationInterruptMode = 'yes' | 'no' | 'limited';
export type AnimationLoopMode = 'none' | 'until_replaced' | 'bounded';

export type AnimationExpressionHint =
  | 'blush'
  | 'sleepy'
  | 'happy'
  | 'surprised'
  | 'curious'
  | 'idle'
  | 'winking'
  | 'pout';

export type AnimationPropHint =
  | 'pillow'
  | 'heart'
  | 'question'
  | 'sparkle'
  | 'none';
```

`emotionalTone` не является provider hint: финальное значение приходит после решения Character Engine.

`expressionHint` описывает семантическую мимику (`blush`, `sleepy`, `happy`, `surprised`, `curious`, `idle`, `winking`, `pout`). Отсутствие `expressionHint` означает, что Animation Controller / Resolver может выбрать default expression для `kind + emotionalTone`.

`propHint` описывает семантический реквизит или эффект (`pillow`, `heart`, `question`, `sparkle`, `none`). Он не является physical asset path и не задаёт способ отрисовки.

`priority`, `interrupt` и `loop` в `AnimationIntent` являются входными метаданными запроса. Resolved animation policy принадлежит Animation Controller: он может повысить priority, запретить interrupt, изменить loop mode или передать fallback-указания с учётом текущего animation state.

## Начальный каталог

| `kind` | Category | Requested priority | Requested interrupt | Requested loop | Назначение |
|---|---|---|---|---|---|
| `idle_blink` | idle | low | yes | bounded | Нейтральный idle micro-motion. |
| `thinking_loop` | dialogue | normal | yes | until_replaced | Визуальное ожидание ответа provider-а. |
| `talking` | dialogue | normal | yes | bounded | Сопровождение ответа Wisp. |
| `happy_reaction` | reaction | normal | yes | bounded | Позитивная реакция, игра, дружелюбие, тепло. |
| `confused_reaction` | reaction | normal | yes | bounded | Непонимание, удивление, смущение или fallback reaction. |
| `sleep_start` | sleep | high | limited | none | Visual transition после resolved `sleep`. |
| `sleep_loop` | sleep | high | limited | until_replaced | Устойчивое visual state активного semantic sleep. |
| `wake_up` | transition | high | no | none | Visual transition после resolved `wake`; direct drag использует свой lifecycle. |
| `dragged` | movement | critical | no | until_replaced | Прямое перетаскивание пользователем. |
| `spook` | reaction | critical | no | bounded | Резкая защитная реакция на emergency/system stimulus. |
| `land` | transition | high | no | none | Стабилизация после drag movement. |
| `walk` | movement | normal | yes | until_replaced | Автономное перемещение / блуждание. |
| `settle` | transition | low | yes | none | Мягкий возврат в устойчивое состояние. |

## Тон и подсказки

Базовый маппинг эмоционального тона в визуальные подсказки:

| `SynthesizedEmotionalTone` | Default `expressionHint` | Default `propHint` | Семантика |
|---|---|---|---|
| `shy` | `blush` | `none` | Осторожность, отведённый взгляд, мягкое смущение. |
| `sleepy` | `sleepy` | `pillow` для sleep states, иначе `none` | Усталость, потребность в покое, сниженная активность. |
| `playful` | `winking` | `sparkle` | Игривость, дружелюбный вызов, лёгкая шалость. |
| `curious` | `curious` | `question` | Интерес, задумчивость, поиск ответа. |
| `neutral` | `idle` | `none` | Спокойное базовое состояние. |
| `affectionate` | `happy` | `heart` | Тепло, доверие, нежность при соблюдении intimacy gates. |
| `flustered` | `blush` | `heart` | Сильное смущение, румянец, романтическое напряжение. |

`blush` является expression-level подсказкой, а не отдельным behavior decision. Character Engine решает, допустим ли `affectionate` или `flustered` тон с учетом `IntimacyState`, `Relationship`, `Needs.energy` и `Needs.comfort`.

## Сводная матрица маппинга

Таблица ниже задаёт обязательный маппинг `BehaviorIntent + SynthesizedEmotionalTone -> AnimationIntent`. В ячейках указан `kind`, а в скобках — semantic overrides для `expressionHint` / `propHint`, если они отличаются от default tone mapping.

| `BehaviorIntentKind` | `shy` | `sleepy` | `playful` | `curious` | `neutral` | `affectionate` | `flustered` |
|---|---|---|---|---|---|---|---|
| `respond` | `talking` (`blush`) -> `settle` | `talking` (`sleepy`) -> `settle` | `talking` (`winking`, `sparkle`) -> `settle` | `talking` (`curious`, `question`) -> `settle` | `talking` (`idle`) -> `settle` | `talking` (`happy`, `heart`) -> `settle` | `talking` (`blush`, `heart`) -> `settle` |
| `think` | `thinking_loop` (`blush`) | `thinking_loop` (`sleepy`) | `thinking_loop` (`curious`, `sparkle`) | `thinking_loop` (`curious`, `question`) | `thinking_loop` (`curious`) | `thinking_loop` (`happy`, `heart`) | `thinking_loop` (`blush`, `heart`) |
| `react_happy` | `happy_reaction` (`blush`) -> `settle` | `happy_reaction` (`sleepy`) -> `settle` | `happy_reaction` (`winking`, `sparkle`) -> `settle` | `happy_reaction` (`curious`) -> `settle` | `happy_reaction` (`happy`) -> `settle` | `happy_reaction` (`happy`, `heart`) -> `settle` | `happy_reaction` (`blush`, `heart`) -> `settle` |
| `react_confused` | `confused_reaction` (`blush`, `question`) -> `settle` | `confused_reaction` (`sleepy`, `question`) -> `settle` | `confused_reaction` (`surprised`, `sparkle`) -> `settle` | `confused_reaction` (`curious`, `question`) -> `settle` | `confused_reaction` (`surprised`, `question`) -> `settle` | `confused_reaction` (`pout`, `heart`) -> `settle` | `confused_reaction` (`blush`, `heart`) -> `settle` |
| `play` | `happy_reaction` (`blush`) -> `settle` | `happy_reaction` (`sleepy`) -> `settle` | `walk` (`winking`, `sparkle`) -> `settle` | `walk` (`curious`, `question`) -> `settle` | `walk` (`happy`) -> `settle` | `happy_reaction` (`happy`, `heart`) -> `settle` | `happy_reaction` (`blush`, `heart`) -> `settle` |
| `sleep` | `sleep_start` (`blush`, `pillow`) -> `sleep_loop` | `sleep_start` (`sleepy`, `pillow`) -> `sleep_loop` | `sleep_start` (`sleepy`, `pillow`) -> `sleep_loop` | `sleep_start` (`sleepy`, `pillow`) -> `sleep_loop` | `sleep_start` (`sleepy`, `pillow`) -> `sleep_loop` | `sleep_start` (`happy`, `pillow`) -> `sleep_loop` | `sleep_start` (`blush`, `pillow`) -> `sleep_loop` |
| `wake` | `wake_up` (`blush`) -> `settle` | `wake_up` (`sleepy`) -> `settle` | `wake_up` (`winking`) -> `settle` | `wake_up` (`curious`) -> `settle` | `wake_up` (`idle`) -> `settle` | `wake_up` (`happy`, `heart`) -> `settle` | `wake_up` (`blush`) -> `settle` |
| `drag` | `dragged` (`surprised`) | `dragged` (`surprised`) | `dragged` (`surprised`) | `dragged` (`surprised`) | `dragged` (`surprised`) | `dragged` (`surprised`) | `dragged` (`surprised`, `heart`) |
| `land` | `land` (`blush`) -> `settle` | `land` (`sleepy`) -> `settle` | `land` (`happy`) -> `settle` | `land` (`curious`) -> `settle` | `land` (`idle`) -> `settle` | `land` (`happy`) -> `settle` | `land` (`blush`) -> `settle` |
| `wander` | `walk` (`blush`) -> `settle` | `walk` (`sleepy`) -> `settle` | `walk` (`winking`, `sparkle`) -> `settle` | `walk` (`curious`, `question`) -> `settle` | `walk` (`idle`) -> `settle` | `walk` (`happy`, `heart`) -> `settle` | `walk` (`blush`, `heart`) -> `settle` |
| `idle` | `idle_blink` (`blush`) | `idle_blink` (`sleepy`) | `idle_blink` (`winking`, `sparkle`) | `idle_blink` (`curious`, `question`) | `idle_blink` (`idle`) | `idle_blink` (`happy`, `heart`) | `idle_blink` (`blush`, `heart`) |
| `quiet` | `idle_blink` (`blush`); active sleep сохраняет `sleep_loop` | `idle_blink` (`sleepy`); active sleep сохраняет `sleep_loop` | `idle_blink` (`idle`) | `idle_blink` (`curious`) | `idle_blink` (`idle`) | `idle_blink` (`happy`) | `idle_blink` (`blush`) |

Правила применения матрицы:
- `emotionalTone` всегда заполняется в выходном `AnimationIntent`.
- Если ячейка указывает sequence, первый `AnimationIntent` является текущим request, а последующий устойчивый state планируется Animation Controller после завершения bounded transition/reaction.
- `settle` возвращает персонажа в устойчивое состояние: обычно `idle_blink`, а во время активного sleep mode — `sleep_loop`.
- `quiet` не является sleep decision и не запускает `sleep_start` / `sleep_loop`. Если semantic sleep уже активен, quiet presentation не отменяет его visual lifecycle.
- Direct user interaction (`drag`, `land`) сохраняет своё `kind` независимо от тона; тон влияет только на expression/prop hints.

## Витальный сон и пробуждение

Authoritative semantic rules и пороги находятся в разделе [`CHARACTER_ENGINE.md`](./CHARACTER_ENGINE.md#21-каноническая-семантика-сна-и-пробуждения). Animation Engine не читает `Needs` и только формирует visual lifecycle после resolved `sleep` / `wake` либо более приоритетного direct interaction.

### Засыпание

Resolved `sleep` создаёт visual sequence:

```text
sleep_start (priority: high, interrupt: limited, loop: none)
  -> sleep_loop (priority: high, interrupt: limited, loop: until_replaced, propHint: 'pillow')
```

Инварианты сна:
- `sleep_start` защищён от обычных `normal` и `low` реакций.
- `sleep_loop` является устойчивым состоянием, а не временной reaction animation.
- Фоновые `idle`, `wander`, idle micro-motion и blink timers не прерывают `sleep_loop`.
- Неразрешённые Character Engine behavior intents не меняют visual sleep lifecycle.
- Animation Controller не выходит из `sleep_loop` из-за отсутствия специализированного sleep visual; он применяет fallback policy и сохраняет sleep state.

### Пробуждение

Resolved `wake` создаёт `wake_up`. Animation Engine не проверяет причину или пороги этого решения.

Resolved visual sequence:

```text
wake_up (priority: high, interrupt: no, loop: none)
  -> settle
  -> idle_blink
```

Правила пробуждения:
- `drag` во время сна имеет `critical` priority и немедленно заменяет `sleep_loop` на `dragged`; после завершения drag flow следует `land`, затем `settle`, без обязательного `wake_up`.
- Неразрешённый `wake`, обычный `idle` или `wander` не создаёт `wake_up`.
- `wake_up` не прерывается обычными dialogue/reaction intents.
- После `wake_up` Character Engine остаётся источником semantic state; Animation Controller не решает, следует ли снова заснуть.

Animation lifecycle names не становятся полями Character state, а semantic `sleep` / `wake` не используются как имена клипов или кадров.

## Graceful Degradation

Animation Controller и Asset/Fallback Resolver обязаны поддерживать многоуровневый fallback для неполного графического пака. Неполнота visual assets никогда не должна приводить к падению Animation FSM, зависанию sequence или рассинхронизации behavior/animation state.

Fallback algorithm:

| Уровень | Условие | Действие Resolver / Controller | Гарантия |
|---|---|---|---|
| Level 1 | Доступен специализированный visual variant для `kind + emotionalTone + expressionHint + propHint`. | Использовать наиболее точное совпадение, например отдельный variant для flustered blush reaction. | Семантика intent отображается максимально богато. |
| Level 2 | Специализированного variant нет, но доступен базовый visual cycle категории. | Использовать базовую роль категории (`body_idle`, `body_walk`, dialogue/reaction/sleep base) и наложить semantic expression/prop layer, если он доступен. | `propHint: 'heart'`, `propHint: 'question'`, `propHint: 'sparkle'`, `propHint: 'pillow'` и `expressionHint: 'blush'` деградируют независимо от body cycle. |
| Level 3 | Нет безопасного совпадения для категории или overlay layer. | Откатиться к стабильному `idle_blink` с `expressionHint: 'idle'` и `propHint: 'none'`, сохранив resolved FSM transition. | FSM продолжает работу, bounded sequence завершается, loop state остаётся заменяемым. |

Fallback invariants:
- Fallback меняет только presentation choice, но не переписывает исходный `BehaviorIntent` и не подменяет решение Character Engine.
- Fallback не повышает эмоциональную интенсивность. Например `shy` может потерять blush overlay, но не превращается в `affectionate`.
- Для `sleep_loop` Level 3 не отменяет sleep mode. Если нет sleep visual, Controller выбирает самый спокойный стабильный visual state и продолжает считать активным resolved sleep state.
- Для `critical` user interaction fallback обязан сохранять интерактивную FSM-семантику: `dragged` остаётся drag state даже при простом visual representation.
- Ошибка поиска visual variant является diagnostic event для development tooling, но не user-facing failure.

## Priority и interrupt rules

| Priority | Intents | Interrupt policy | Правило |
|---|---|---|---|
| `critical` | `dragged`, `spook` | Прерывает любое состояние без задержек. | Используется только для прямого user interaction или emergency/system stimulus. |
| `high` | `wake_up`, `land`, `sleep_start`, `sleep_loop` | Защищены от обычных `normal` и `low` реакций. | Может быть заменён только `critical` intent или явно разрешённым lifecycle transition. |
| `normal` | `thinking_loop`, `talking`, `happy_reaction`, `confused_reaction`, `walk` | Прерываются пользовательским вводом и `high`/`critical` событиями. | Не прерывают устойчивый `sleep_loop` без разрешения Character Engine. |
| `low` | `idle_blink`, `settle` | Прерываются любым событием. | Используются для micro-motion и мягкой стабилизации. |

Дополнительные правила:
- Прямое воздействие пользователя (`dragged`, `land`, click-derived `wake_up`) приоритетнее таймеров и автономных реакций.
- `thinking_loop` замещается на `talking` при получении ответа или на `confused_reaction` при ошибке provider-а.
- Временные реакции (`happy_reaction`, `confused_reaction`, `spook`) всегда возвращаются в устойчивое состояние (`idle_blink` или `sleep_loop`).
- `sleep_loop` удерживается до `wake_up`, `dragged`, `spook` или другого разрешённого Character Engine lifecycle transition.
- Low-priority idle micro-motion, blink и settle events никогда не отменяют bounded transition, active dialogue или sleep state.

## Граница Render Engine

`ANIMATION_ENGINE.md` не описывает детали ассетов, пикселей и UI implementation. Следующие категории принадлежат `RENDER_ENGINE.md` и не являются public Animation Engine contract:
- physical asset paths, concrete file names и renderer resource layout;
- texture dimensions, sprite slicing grid, frame indexes и asset-specific playback timing;
- renderer framework primitives, imperative document commands, CSS classes и layout rules;
- interprocess channel names, native window handles и platform-specific APIs;
- pixel ratio, anchors, hitboxes и coordinate math.

Render Engine получает presentation-ready visual state (`RenderPresentationState`) от AnimationPlayer и отрисовывает его через `ICharacterRenderer`. Render Engine не принимает решений о поведении, не парсит provider DTO и не вычисляет Character Engine формулы.
