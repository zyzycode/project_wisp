# Контракт AnimationIntent

`AnimationIntent` — semantic visual request после принятого поведения. Он описывает, какое визуальное состояние нужно показать, но не описывает concrete sprite file, frame index, render geometry, rows/columns, asset path, renderer component или platform API.

Документ является source of truth для Animation Engine. Implementer-агенты не меняют этот contract без Architect review.

## Поток ответственности

```text
ProviderResponseIntentMapper
  -> BehaviorIntent
  -> Character Engine
  -> AnimationIntent
  -> Animation Controller
  -> Render Engine
```

- Character Engine принимает или отклоняет `BehaviorIntent` с учетом `Needs`, `Relationship`, `Personality`, `IntimacyState` и текущего `SynthesizedEmotionalTone`.
- Animation Engine переводит принятое поведение в semantic `AnimationIntent`.
- Animation Controller применяет resolved priority, interrupt rules, loop policy, sleep stability и graceful fallback.
- Render Engine отображает уже выбранный presentation-ready visual state через render contract.

Animation Engine не принимает решений о поведении персонажа и не читает raw provider DTO. Он получает уже нормализованный `BehaviorIntent` и актуальный эмоциональный тон от Character Engine / Application boundary.

## Форма intent

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

export type SynthesizedEmotionalTone =
  | 'shy'
  | 'sleepy'
  | 'playful'
  | 'curious'
  | 'neutral'
  | 'affectionate'
  | 'flustered';

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

`emotionalTone` синхронизирован со словарём `SynthesizedEmotionalTone` из `CHARACTER_ENGINE.md`. Это не provider hint: финальное значение приходит после решения Character Engine.

`expressionHint` описывает семантическую мимику (`blush`, `sleepy`, `happy`, `surprised`, `curious`, `idle`, `winking`, `pout`). Отсутствие `expressionHint` означает, что Animation Controller может выбрать default expression для `kind + emotionalTone`.

`propHint` описывает семантический реквизит или эффект (`pillow`, `heart`, `question`, `sparkle`, `none`). Он не является physical asset path и не задаёт способ отрисовки.

`priority`, `interrupt` и `loop` в `AnimationIntent` являются входными метаданными запроса. Resolved animation policy принадлежит Animation Controller: он может повысить priority, запретить interrupt, изменить loop mode или выбрать fallback с учётом текущего animation state.

## Начальный каталог

| `kind` | Category | Requested priority | Requested interrupt | Requested loop | Назначение |
|---|---|---|---|---|---|
| `idle_blink` | idle | low | yes | bounded | Нейтральный idle micro-motion. |
| `thinking_loop` | dialogue | normal | yes | until_replaced | Визуальное ожидание ответа provider-а. |
| `talking` | dialogue | normal | yes | bounded | Сопровождение ответа Wisp. |
| `happy_reaction` | reaction | normal | yes | bounded | Позитивная реакция, игра, дружелюбие, тепло. |
| `confused_reaction` | reaction | normal | yes | bounded | Непонимание, удивление, смущение или fallback reaction. |
| `sleep_start` | sleep | high | limited | none | Переход в сон / quiet rest behavior. |
| `sleep_loop` | sleep | high | limited | until_replaced | Устойчивый сон или quiet visual state. |
| `wake_up` | transition | high | no | none | Переход из sleep / quiet state. |
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
| `quiet` | `idle_blink` (`blush`) или `sleep_loop` | `sleep_loop` (`sleepy`, `pillow`) | `idle_blink` (`idle`) | `idle_blink` (`curious`) | `idle_blink` (`idle`) | `idle_blink` (`happy`) | `idle_blink` (`blush`) |

Правила применения матрицы:
- `emotionalTone` всегда заполняется в выходном `AnimationIntent`.
- Если ячейка указывает sequence, первый `AnimationIntent` является текущим request, а последующий устойчивый state планируется Animation Controller после завершения bounded transition/reaction.
- `settle` возвращает персонажа в устойчивое состояние: обычно `idle_blink`, а во время активного sleep mode — `sleep_loop`.
- `quiet` не является sleep decision сам по себе. Он может визуально использовать `sleep_loop`, только если Character Engine уже перевёл персонажа в quiet rest / sleep mode.
- Direct user interaction (`drag`, `land`) сохраняет своё `kind` независимо от тона; тон влияет только на expression/prop hints.

## Витальный сон и пробуждение

Character Engine владеет `Needs` и решает, когда сон допустим или обязателен. Animation Engine только формирует визуальную последовательность после принятого решения.

### Засыпание

При выполнении любого из условий Character Engine должен инициировать или принять `BehaviorIntentKind: 'sleep'`, если нет более приоритетного прямого пользовательского взаимодействия:
- `Needs.energy <= 20`;
- `Needs.comfort >= 80`.

Resolved visual sequence:

```text
sleep_start (priority: high, interrupt: limited, loop: none)
  -> sleep_loop (priority: high, interrupt: limited, loop: until_replaced, propHint: 'pillow')
```

Инварианты сна:
- `sleep_start` защищён от обычных `normal` и `low` реакций.
- `sleep_loop` является устойчивым состоянием, а не временной reaction animation.
- Фоновые `idle`, `wander`, idle micro-motion и blink timers не прерывают `sleep_loop`.
- Provider-origin `respond`, `think`, `play`, `react_happy` и `react_confused` не будят Wisp сами по себе; Character Engine может отложить или отклонить их по sleep/quiet rules.
- Animation Controller не выходит из `sleep_loop` из-за отсутствия специализированного sleep visual; он применяет fallback policy и сохраняет sleep state.

### Пробуждение

`wake_up` создаётся только при одном из событий:
- прямой пользовательский click / drag interaction;
- критический дефицит внимания: `Needs.attention >= 90`;
- завершение sleep cycle после восстановления энергии: `Needs.energy >= 80`.

Resolved visual sequence:

```text
wake_up (priority: high, interrupt: no, loop: none)
  -> settle
  -> idle_blink
```

Правила пробуждения:
- `drag` во время сна имеет `critical` priority и может немедленно заменить `sleep_loop` на `dragged`; после завершения drag flow следует `land`, затем `settle`.
- Обычный timer-only `idle` или `wander` не создаёт `wake_up`.
- `wake_up` не прерывается обычными dialogue/reaction intents.
- После `wake_up` Character Engine остаётся источником истины: если `Needs.energy` всё ещё низкая или `Needs.comfort` всё ещё высокая, следующий устойчивый state может снова перейти в sleep/quiet flow.

## Graceful Degradation

Animation Controller обязан поддерживать многоуровневый fallback для неполного графического пака. Неполнота visual assets никогда не должна приводить к падению Animation FSM, зависанию sequence или рассинхронизации behavior/animation state.

Fallback algorithm:

| Уровень | Условие | Действие Controller-а | Гарантия |
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

`ANIMATION_ENGINE.md` не описывает детали ассетов, пикселей и UI implementation. Следующие категории принадлежат будущему `RENDER_ENGINE.md` и не являются public Animation Engine contract:
- physical asset paths, concrete file names и renderer resource layout;
- texture dimensions, sprite slicing grid, frame indexes и asset-specific playback timing;
- renderer framework primitives, imperative document commands, CSS classes и layout rules;
- interprocess channel names, native window handles и platform-specific APIs;
- pixel ratio, anchors, hitboxes и coordinate math.

Render Engine получает presentation-ready visual state от Animation Controller и отрисовывает его. Render Engine не принимает решений о поведении, не парсит provider DTO и не вычисляет Character Engine formulas.
