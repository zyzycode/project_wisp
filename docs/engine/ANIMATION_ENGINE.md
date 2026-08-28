# Контракт AnimationIntent

`AnimationIntent` — semantic visual request после принятого поведения. Он описывает, какое визуальное состояние нужно показать, но не описывает конкретный sprite/SVG file, frame index, frame size, rows/columns или asset path.

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

- Character Engine принимает или отклоняет `BehaviorIntent` с учетом `Needs`, `Relationship` и `Personality`.
- Animation Engine переводит принятое поведение в `AnimationIntent`.
- Animation Controller применяет resolved timing, priority, interrupt rules и fallback.
- Render Engine отображает уже выбранный visual state через render contract.

## Форма intent

```typescript
export interface AnimationIntent {
  kind: AnimationIntentKind;
  category: 'idle' | 'reaction' | 'movement' | 'dialogue' | 'sleep' | 'transition';
  priority: AnimationPriority;
  interrupt: 'yes' | 'no' | 'limited';
  loop: 'none' | 'until_replaced' | 'bounded';
  requestedBy: BehaviorIntentKind | 'system';
  propHint?: 'pillow' | 'heart' | 'question' | 'none';
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
  | 'land'
  | 'walk'
  | 'settle';

export type AnimationPriority = 'low' | 'normal' | 'high' | 'critical';
```

`propHint` описывает семантический реквизит / эффект (`pillow`, `heart`, `question`), а не путь к файлу. Конкретные имена ассетов и их слои принадлежат будущему `RENDER_ENGINE.md`; до его создания asset-level детали не являются public engine contract.

`priority`, `interrupt` и `loop` в `AnimationIntent` являются входными метаданными запроса. Resolved animation policy принадлежит Animation Controller: он может повысить priority, запретить interrupt, изменить loop mode или выбрать fallback с учётом текущего animation state.

## Начальный каталог

| `kind` | Category | Requested priority | Requested interrupt | Requested loop | Назначение |
|---|---|---|---|---|---|
| `idle_blink` | idle | low | yes | bounded | Нейтральный idle micro-motion. |
| `thinking_loop` | dialogue | normal | yes | until_replaced | Визуальное ожидание ответа provider-а. |
| `talking` | dialogue | normal | yes | bounded | Сопровождение ответа Wisp. |
| `happy_reaction` | reaction | normal | yes | bounded | Позитивная реакция (радость, поглаживание). |
| `confused_reaction` | reaction | normal | yes | bounded | Непонимание, смущение, fallback. |
| `sleep_start` | sleep | high | limited | none | Переход в сон / quiet behavior. |
| `sleep_loop` | sleep | high | limited | until_replaced | Спящий или quiet visual state. |
| `wake_up` | transition | high | no | none | Переход из sleep / quiet state. |
| `dragged` | movement | critical | no | until_replaced | Прямое перетаскивание пользователем. |
| `land` | transition | high | no | none | Стабилизация после drag movement. |
| `walk` | movement | normal | yes | until_replaced | Автономное перемещение / блуждание. |
| `settle` | transition | low | yes | none | Мягкий возврат в idle. |

## Обязательные сценарии маппинга

Таблица соответствия входящих намерений поведения (`BehaviorIntent`) выходным визуальным запросам (`AnimationIntent`):

| Сценарий | BehaviorIntent | AnimationIntent |
|---|---|---|
| Chat reply | `respond` | `talking`, затем `settle` или `idle_blink` |
| Thinking | `think` | `thinking_loop` |
| Happy reaction | `react_happy` | `happy_reaction` (с optional `propHint: 'heart'`) |
| Confused reaction | `react_confused` | `confused_reaction` (с optional `propHint: 'question'`) |
| Play | `play` | `happy_reaction` или `walk`, затем `settle` |
| Sleep | `sleep` | `sleep_start`, затем `sleep_loop` с optional `propHint: 'pillow'` |
| Wake up | `wake` | `wake_up`, затем `settle` или `idle_blink` |
| Drag | `drag` | `dragged` |
| Landing | `land` | `land`, затем `settle` или `idle_blink` |
| Wander | `wander` | `walk`, затем `settle` |
| Idle | `idle` | `idle_blink` |
| Quiet | `quiet` | `sleep_loop` или спокойный `idle_blink` |

## Priority и interrupt rules

### Правила:
- `critical` intents (например, `dragged`) являются emergency request и немедленно прерывают любые другие анимации.
- Прямое воздействие пользователя (`dragged`, `land`) приоритетнее таймеров и автономных реакций.
- `wake_up` не прерывается обычными idle/reaction intents.
- `sleep_loop` удерживается до `wake` или прямого взаимодействия. Обычные фоновые idle-события не будят спящего Wisp.
- `thinking_loop` замещается на `talking` при получении ответа или на `confused_reaction` при ошибке.
- Временные реакции (`happy_reaction`, `confused_reaction`) всегда возвращаются в устойчивое состояние (`idle_blink`, `sleep_loop`).
- Если запрошенная анимация недоступна, Animation Controller выбирает fallback той же категории, затем `idle_blink`.

## Граница Render Engine

`ANIMATION_ENGINE.md` не описывает детали ассетов и пикселей. Следующие параметры принадлежат будущему `RENDER_ENGINE.md` и до его создания не являются public engine contract:
- frame size (512×512 px);
- rows/columns, sprite sheet slicing;
- конкретные пути к файлам (`body/idle/body_idle_00.png` и т.д.);
- SVG-пути;
- pixel ratio, anchors (pivot X=256, Y=460), hitboxes;
- точная длительность кадров для конкретного ассета.

Render Engine получает presentation-ready visual state от Animation Controller и отрисовывает его. Render Engine не принимает решений о поведении и не парсит логику персонажа.
