# SKILL: animation-system — Система анимаций компаньона

Руководство по архитектуре и принципам работы контроллера анимаций персонажа.

---

## 1. Архитектурная модель анимаций

Система анимаций отделена от физики, AI-провайдеров и UI-компонентов. Она представляет собой детерминированную стейт-машину (FSM), управляемую `AnimationIntent`, приоритетами и событиями.

### Основные компоненты:
1. **Animation State:** Текущий активный semantic animation state (`idle_blink`, `walk`, `dragged`, `land`, `sleep_loop`, `thinking_loop`, `talking`, `settle`).
2. **Animation Controller:** Модуль (Pure TypeScript), управляющий выбором клипов, переключением состояний, воспроизведением циклов и событиями окончания (`onComplete`).
3. **Transition Rules:** Таблица допустимых переходов между анимационными состояниями.
4. **Render Engine:** Отдельный renderer module, который отображает visual render props через SVG сейчас, sprite sheets позже и возможный rigging в будущем.

---

## 2. Приоритеты и прерываемость (Interruptibility & Priorities)

Не все анимации могут быть прерваны мгновенно. Система оперирует уровнями приоритета:

| Приоритет | Категория | Примеры | Поведение при новом стимуле |
|---|---|---|---|
| **0 (Низкий)** | Фоновые циклы | `idle_blink`, `sleep_loop` | Мгновенно прерываются любым событием |
| **1 (Средний)** | Автономные действия | `walk`, `settle` | Прерываются пользовательским вводом |
| **2 (Высокий)** | Реакции и эмоции | `happy_reaction`, `confused_reaction`, `wake_up` | Доигрывают до конца кадра/цикла, если нет Drag |
| **3 (Критический)** | Прямой ввод пользователя | `dragged`, `land` | Мгновенно прерывают любые другие анимации |

Примеры в таблице — public `AnimationIntentKind` из `docs/engine/ANIMATION_ENGINE.md`. Будущие internal clip names вроде `walk_cycle` или `idle_breathe` допустимы только внутри Render/Animation implementation и не заменяют public intent contract.

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
- Он не выбирает конкретные SVG/sprite files, frame size, rows/columns или asset paths. Эти детали принадлежат будущему `docs/engine/RENDER_ENGINE.md`; до его создания они не являются public engine contract.
- Он не принимает behavior decisions: `SynthesizedEmotionalTone`, energy, quiet mode и cooldown rules приходят из Character/Behavior Engine.
