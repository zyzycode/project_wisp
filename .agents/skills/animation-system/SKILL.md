# SKILL: animation-system — Система анимаций компаньона

Руководство по архитектуре и принципам работы контроллера анимаций персонажа.

---

## 1. Архитектурная модель анимаций

Система анимаций отделена от физики, AI-провайдеров и UI-компонентов. Она представляет собой детерминированную стейт-машину (FSM), управляемую `AnimationIntent`, приоритетами и событиями.

### Основные компоненты:
1. **Animation State:** Текущий активный клип (`idle_blink`, `walk_left`, `dragged_struggle`, `fall_down`, `land_impact`, `sleep_loop`, `think_bubble`).
2. **Animation Controller:** Модуль (Pure TypeScript), управляющий выбором клипов, переключением состояний, воспроизведением циклов и событиями окончания (`onComplete`).
3. **Transition Rules:** Таблица допустимых переходов между анимационными состояниями.
4. **Render Engine:** Отдельный renderer module, который отображает visual render props через SVG сейчас, sprite sheets позже и возможный rigging в будущем.

---

## 2. Приоритеты и прерываемость (Interruptibility & Priorities)

Не все анимации могут быть прерваны мгновенно. Система оперирует уровнями приоритета:

| Приоритет | Категория | Примеры | Поведение при новом стимуле |
|---|---|---|---|
| **0 (Низкий)** | Фоновые циклы | `idle_breathe`, `sleep_loop` | Мгновенно прерываются любым событием |
| **1 (Средний)** | Автономные действия | `walk_cycle`, `sit_down`, `yawn` | Прерываются пользовательским вводом |
| **2 (Высокий)** | Реакции и эмоции | `surprised`, `laugh`, `nod` | Доигрывают до конца кадра/цикла, если нет Drag |
| **3 (Критический)** | Прямой ввод пользователя | `dragged_grab`, `mouse_click` | Мгновенно прерывают любые другие анимации |

---

## 3. Структура анимационного клипа (Animation Clip Contract)

```typescript
export interface AnimationKeyframe {
  frameIndex: number;
  durationMs: number;
  spriteName: string;
}

export interface AnimationClip {
  id: string;
  name: string;
  loop: boolean;
  priority: number;
  frames: AnimationKeyframe[];
  defaultNextClip?: string; // Что включать после завершения, если loop = false
}
```

---

## 4. Изоляция от внешних SDK
- Анимационный контроллер **ничего не знает об LLM, сетевых протоколах или SQLite**.
- Он получает исключительно внутренние `AnimationIntent` / animation events от behavior layer.
- Он не выбирает конкретные SVG/sprite files, frame size, rows/columns или asset paths. Эти детали принадлежат Render Engine contract в `docs/engine/RENDER_ENGINE.md`.
- Он не принимает behavior decisions: mood, energy, quiet mode и cooldown rules приходят из Character/Behavior Engine.
