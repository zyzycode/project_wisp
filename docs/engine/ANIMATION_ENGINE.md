# Контракт AnimationIntent

`AnimationIntent` — semantic visual request после принятого поведения. Он описывает, какое визуальное состояние нужно показать, но не описывает конкретный sprite/SVG file, frame index, frame size, rows/columns или asset path.

Документ является начальным каталогом для Phase 9. Implementer-агенты не меняют этот contract без Architect review.

## Поток ответственности

```text
ProviderResponseIntentMapper
  -> BehaviorIntent
  -> Character Engine
  -> AnimationIntent
  -> Animation Controller
  -> Render Engine
```

- Character Engine принимает или отклоняет `BehaviorIntent`.
- Animation Engine переводит принятое поведение в `AnimationIntent`.
- Animation Controller применяет resolved timing, priority, interrupt rules и fallback.
- Render Engine отображает уже выбранный visual state через render contract.

## Форма intent

Точная TypeScript-форма вводится implementation-задачей. Начальная shape:

```typescript
type AnimationIntent = {
  kind: AnimationIntentKind;
  category: 'idle' | 'reaction' | 'movement' | 'dialogue' | 'sleep' | 'transition';
  priority: AnimationPriority;
  interrupt: 'yes' | 'no' | 'limited';
  loop: 'none' | 'until_replaced' | 'bounded';
  requestedBy: BehaviorIntentKind | 'system';
  propHint?: 'pillow' | 'thought_icon' | 'none';
};
```

`propHint` описывает semantic prop, а не asset path. Конкретные asset names и layout принадлежат `RENDER_ENGINE.md`.

`priority`, `interrupt` и `loop` в `AnimationIntent` являются requested/default metadata. Resolved animation policy принадлежит Animation Controller: он может повысить priority, запретить interrupt, заменить loop mode или выбрать fallback с учётом текущего animation state.

## Начальный каталог

Каталог ниже задаёт минимальный стартовый набор, а не финальный предел системы. Количество visual states, reactions, transition intents и supported interactions должно расширяться вместе с поведением Wisp, если новые intents остаются semantic visual requests и не включают concrete assets или frame-level details.

| `kind` | Category | Requested priority | Requested interrupt | Requested loop | Назначение |
|---|---|---|---|---|---|
| `idle_blink` | idle | low | yes | bounded | Нейтральный idle micro-motion. |
| `thinking_loop` | dialogue | normal | yes | until_replaced | Визуальное ожидание ответа provider-а. |
| `talking` | dialogue | normal | yes | bounded | Сопровождение ответа Wisp. |
| `happy_reaction` | reaction | normal | yes | bounded | Позитивная реакция. |
| `confused_reaction` | reaction | normal | yes | bounded | Непонимание, fallback или неоднозначный ввод. |
| `sleep_start` | sleep | high | limited | none | Переход в сон/quiet behavior. |
| `sleep_loop` | sleep | high | limited | until_replaced | Спящий или quiet visual state. |
| `wake_up` | transition | high | no | none | Переход из sleep/quiet state. |
| `dragged` | movement | critical | no | until_replaced | Прямое перетаскивание пользователем. |
| `land` | transition | high | no | none | Стабилизация после drag/fall. |
| `walk` | movement | normal | yes | until_replaced | Автономное или принятое перемещение. |
| `settle` | transition | low | yes | none | Мягкий возврат в idle. |

## Обязательные сценарии

Сценарии ниже являются обязательной базой для Phase 9. Будущие документы и Architect review могут добавить новые сценарии и interaction-specific animation intents без изменения роли Render Engine.

| Сценарий | BehaviorIntent | AnimationIntent |
|---|---|---|
| Chat reply | `respond` | `talking`, затем `settle` или `idle_blink` |
| Thinking | `think` | `thinking_loop` |
| Happy reaction | `react_happy` | `happy_reaction` |
| Confused reaction | `react_confused` | `confused_reaction` |
| Sleep | `sleep` | `sleep_start`, затем `sleep_loop` с optional `propHint: 'pillow'` |
| Wake up | `wake` | `wake_up`, затем `settle` или `idle_blink` |
| Drag | `drag` | `dragged` |
| Landing | `land` | `land`, затем `settle` или `idle_blink` |

## Priority и interrupt rules

`AnimationPriority`:

```typescript
type AnimationPriority = 'low' | 'normal' | 'high' | 'critical';
```

Правила:

- Requested `critical` intents, например `dragged`, являются emergency request и должны прерывать остальные animation intents после validation в Animation Controller.
- User-driven movement/release (`dragged`, `land`) сильнее provider/timer reactions.
- `wake_up` не прерывается обычными idle/reaction intents; direct user drag всё равно имеет emergency priority.
- `sleep_loop` удерживается до `wake` или direct user/system rule. Обычные idle/reaction intents не вытесняют sleep.
- `thinking_loop` может быть заменён `talking`, fallback reaction, user drag или explicit cancel.
- Temporary reactions (`happy_reaction`, `confused_reaction`) должны возвращаться в stable state: `idle_blink`, `sleep_loop` или текущий movement state.
- Если requested animation недоступна или конфликтует с текущим resolved state, Animation Controller выбирает semantic fallback той же категории, затем `idle_blink`.

## Граница Render Engine

`ANIMATION_ENGINE.md` не описывает asset pipeline. Следующие детали принадлежат `RENDER_ENGINE.md`:

- frame size;
- rows/columns;
- sprite sheet slicing;
- concrete asset names и asset paths;
- SVG path details;
- pixel ratio, anchors, hitbox и visual bounds geometry;
- exact frame duration для конкретного asset.

Render Engine получает presentation-ready visual state от Animation Controller и отображает его. Он не принимает behavior decisions и не интерпретирует provider DTO.
