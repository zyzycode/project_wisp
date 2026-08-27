# Контракт BehaviorIntent

`BehaviorIntent` — внутреннее semantic намерение поведения Wisp. Он описывает, что персонаж пытается сделать, но не описывает React UI, DOM, CSS, sprite/SVG asset, animation clip, frame index или render props.

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

- `ProviderResponseIntentMapper` создаёт `BehaviorIntent` из provider DTO.
- Character Engine принимает финальное behavior decision: применяет mood, energy, needs, cooldowns, quiet/sleep mode и приоритет user input.
- Animation Engine/Controller получает уже принятое поведение и переводит его в `AnimationIntent`.
- Render Engine только отображает presentation-ready visual state.

## Форма intent

Точная TypeScript-форма вводится implementation-задачей. Начальная shape:

```typescript
type BehaviorIntent = {
  kind: BehaviorIntentKind;
  source: 'user' | 'provider' | 'timer' | 'memory' | 'system';
  priority: 'low' | 'normal' | 'high' | 'critical';
  replyText?: string;
  moodHint?: 'neutral' | 'happy' | 'curious' | 'sleepy' | 'confused' | 'shy';
  reason?: string;
  requestId?: string;
};
```

`priority` здесь является входной подсказкой. Character Engine может повысить, понизить, отклонить или отложить intent.

## Начальный каталог

Каталог ниже не является закрытым списком навсегда. Количество сценариев, типов взаимодействий и behavior intents должно расширяться по мере развития Wisp, если новые intents сохраняют semantic уровень, не протекают в UI/render details и проходят Architect review.

| `kind` | Ответственность | Типичные источники |
|---|---|---|
| `respond` | Ответить пользователю текстом и перейти в talking/reply behavior. | provider, user |
| `think` | Показать, что Wisp обрабатывает сообщение или задумался. | provider, user, timer |
| `react_happy` | Семантическая позитивная реакция на пользователя или событие. | provider, user |
| `react_confused` | Семантическая реакция непонимания, ошибки или неоднозначного ввода. | provider, user, system |
| `sleep` | Перейти в sleep/quiet behavior, если Character Engine разрешит. | user, provider, timer |
| `wake` | Выйти из sleep/quiet behavior, если правила разрешают. | user, system |
| `drag` | Зафиксировать прямое перетаскивание пользователем. | user |
| `land` | Завершить drag/fall movement и стабилизировать персонажа. | user, system |
| `wander` | Ненавязчивое автономное перемещение. | timer |
| `idle` | Стабильное спокойное поведение без активной цели. | timer, system |
| `quiet` | Подавить навязчивые автономные действия и реплики. | user, settings, system |

## Обязательные сценарии

Сценарии ниже являются обязательным стартовым набором для Phase 9. Будущие фазы могут добавлять новые interaction scenarios, autonomous behaviors и reactions без нарушения текущего контракта.

| Сценарий | BehaviorIntent | Что остаётся вне intent |
|---|---|---|
| Chat reply | `respond` с `replyText` и optional `moodHint` | Конкретный speech bubble layout, animation clip, duration |
| Thinking | `think` | Визуальный loop, frames, spinner/face details |
| Happy reaction | `react_happy` | Выбор happy animation clip или SVG expression |
| Confused reaction | `react_confused` | Выбор confused animation clip или fallback face |
| Sleep | `sleep` | Pillow asset path, sleep frames, exact pose |
| Wake up | `wake` | Wake animation frames и timing |
| Drag | `drag` с `priority: 'critical'` | Window movement math и dragged animation frames |
| Landing | `land` | Landing clip, easing, exact frame sequence |

## Правила принятия

- User `drag` и прямые click/input intents имеют больший приоритет, чем provider/timer intents.
- Character Engine может отклонить `sleep`, если пользователь активно взаимодействует с Wisp.
- Character Engine может отклонить `respond`, если включён quiet mode; Application может сохранить ответ для более позднего показа только после отдельного решения.
- Provider hints не обходят cooldowns, no-spam rules и sleep/quiet restrictions.
- Unknown provider hints мапятся в safe fallback intent, обычно `react_confused`, `idle` или `quiet` по ситуации.

## Запрещено

`BehaviorIntent` не содержит:

- React component names, DOM commands или CSS classes;
- SVG paths, sprite sheet names, frame indexes или asset paths;
- animation fps, frame duration, rows/columns или frame size;
- Electron window handles, IPC channel names или platform details;
- raw provider response DTO.
