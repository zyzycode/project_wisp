# Архитектурная спецификация UI & Renderer (`UI_SPEC.md`)

> [!WARNING]
> **Черновик с известными ошибками — ревью от 2026-08-31.** До исправления не использовать этот документ как единственный источник правды и не переносить примеры в код без сверки:
>
> - **Раздел 3.1, anchors:** ниже ошибочно указано сложение координат. По [render contract](RENDER_ENGINE.md) покадровый anchor заменяет `defaultAnchors`, а не прибавляется к нему.
> - **Схема и раздел 6, IPC:** `window.electronAPI` не соответствует [preload](../../src/preload/index.ts), который предоставляет `window.wispAPI`. Поля DTO сверять с [ipc-contracts.ts](../../src/shared/ipc-contracts.ts): `lookDirection` в текущем `PetPresentationStateDTO` отсутствует.
> - **Раздел 3.2, взгляд:** «вниз / нейтрально» расходится с требованием [#1 P14-P01](https://github.com/zyzycode/project_wisp/issues/1): кадр 3 — вниз.
> - **Связанное изменение CSS:** в [index.css](../../src/renderer/index.css) сняты ограничение высоты и прокрутка облачка. Есть риск обрезания длинных реплик границами окна; визуальная проверка не выполнена.
>
> Замечания только зафиксированы, исправления не внесены. Спецификацию должен согласовать `architect`, CSS проверить `app-developer`, затем нужен повторный review.

`UI_SPEC.md` — черновик описания пользовательского интерфейса (UI), компонентов визуализации и взаимодействия с персонажем в Project Wisp.

Документ определяет архитектурные границы слоя представления (Renderer), структуру компонентов, правила композиции слоёв персонажа, контекстного меню, диалоговых окон и мостов взаимодействия с Main Process.

---

## 1. Архитектурные принципы и границы (Clean Architecture)

Слой Renderer в Project Wisp спроектирован по принципу **Pure Presentation View** (чистое представление).

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        MAIN PROCESS (Owner)                            │
│  - ShimejiMotionOrchestrator (Физика, гравитация, баллистика, коллизии)│
│  - ElectronPetPositionAdapter (Управление нативным окном setPosition)  │
│  - CharacterEngine & MemoryStore (Состояние, потребности, диалоги)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         IPC Stream │ (PetPresentationStateDTO)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      PRELOAD BRIDGE (Isolation)                        │
│  - window.electronAPI.onPetPresentationState(cb)                       │
│  - window.electronAPI.beginPetDrag / movePetDrag / releasePetDrag      │
│  - window.electronAPI.interactWithCharacter(...)                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        RENDERER / UI (React)                           │
│  - DesktopPet.tsx (Root View Container)                                │
│    ├── CharacterRenderer (Слои Body, Face/Gaze, Blush, Props)         │
│    ├── SpeechBubble & ChatInput (Облачко мыслей и диалог)             │
│    ├── ContextMenu (Контекстное меню ПКМ)                              │
│    └── DebugHUD (Панель отладки Ctrl+D)                                │
└────────────────────────────────────────────────────────────────────────┘
```

### 🚫 Строгие запреты для UI / Renderer:
1. **Никакой физики в UI:** В компонентах React **запрещено** вычислять координаты окна, гравитацию, скорость, инерцию, отскоки или запускать локальные `requestAnimationFrame`-циклы перемещения.
2. **Никакого прямого перемещения окна:** UI никогда не вызывает `window.electronAPI.setPosition` для анимации движения. Окно перемещает исключительно Main Process.
3. **Никаких утечек Node.js/Electron:** Renderer изолирован (`contextIsolation: true`). Запрещены прямые импорты `electron`, `fs`, `path`, `better-sqlite3` или прямого `ipcRenderer`.
4. **Никакого изменения бизнес-логики:** UI не меняет напрямую значения шкал `Needs`, не модифицирует FSM переходы и не принимает решений за AI-мозг. UI лишь отправляет события взаимодействия (`interactWithCharacter`).

---

## 2. Иерархия компонентов и структура каталогов

Все UI-компоненты расположены в `src/renderer/`:

```text
src/renderer/
├── components/
│   ├── Character/
│   │   ├── CharacterRenderer.tsx      # Композитор визуальных слоёв персонажа
│   │   ├── SpriteRenderer.tsx         # Покадровый плеер спрайтов из manifest.json
│   │   ├── ProceduralBlush.tsx        # Процедурный слой румянца (Z-30)
│   │   └── PropsOverlay.tsx           # Слой реквизита и визуальных эффектов (Z-40)
│   ├── Interaction/
│   │   └── ContextMenu.tsx            # Контекстное меню по правому клику (ПКМ)
│   ├── Chat/
│   │   ├── SpeechBubble.tsx           # Реплики и мысли питомца
│   │   └── ChatInput.tsx              # Поле ввода сообщений (двойной клик)
│   ├── Debug/
│   │   ├── DebugHUD.tsx               # Панель мониторинга состояния (Ctrl+D)
│   │   ├── AnimationInspector.tsx     # Ручной инспектор и просмотрщик всех спрайтов
│   │   ├── NeedsIndicator.tsx         # Индикаторы шкал Energy, Play, Attention
│   │   └── LogViewer.tsx              # Консоль событий в реальном времени
│   └── DesktopPet.tsx                 # Главный контейнер питомца
├── hooks/                             # React-хуки подписки на IPC и UI-состояния
└── render-engine/                     # Утилиты разрешения спрайтов и таймингов
```

---

## 3. Спецификация отображения персонажа (`CharacterRenderer`)

Визуальный образ Wisp строится из наложения слоев согласно [`RENDER_ENGINE.md`](./RENDER_ENGINE.md):

```text
[Z-40] Props & FX Overlay (сердечки, подушка, вопросики, искры)
  ↑
[Z-30] Procedural Blush (градиентный румянец на щечках)
  ↑
[Z-20] Face / Gaze Layer (мимика face_* или дискретный взгляд face_gaze)
  ↑
[Z-10] Base Body Layer (покадровая анимация тела body_*)
```

### 3.1. Режимы наложения лица (`faceOverlay.mode`)
Для каждой анимации тела в `manifest.json` задан режим оверлея лица:
* **`"mode": "overlay"`** (`body_idle`, `body_sit`, `body_stand_up`, `body_lie`):
  * Тело является безликим силуэтом.
  * Поверх тела рендерится слой лица (`Z-20`).
  * Позиционирование лица рассчитывается строго по анкорам: `defaultAnchors.face` + покадровое смещение `frameMeta[frameIndex].anchors.face` (компенсация дыхания/движения головы).
* **`"mode": "baked_in"`** (`body_walk`, `body_run`, `body_fall`, `body_crash_splat`, `body_sleep`, `body_climb_wall` и др.):
  * Лицо уже запечено в спрайты тела.
  * Слой лица (`Z-20`) **не рендерится**, чтобы избежать двойного наложения глаз.

### 3.2. Дискретный взгляд (`face_gaze`)
* Процедурные зрачки со свободным смещением отключены.
* Взгляд управляется 4-кадровым оверлеем `face_gaze` на основе угла к курсору мыши:
  * **Кадр 0 (`_00.png`):** Взгляд влево (←)
  * **Кадр 1 (`_01.png`):** Взгляд вправо (→)
  * **Кадр 2 (`_02.png`):** Взгляд вверх (↑)
  * **Кадр 3 (`_03.png`):** Взгляд вниз / нейтрально (↓)

---

## 4. Спецификация контекстного меню (`ContextMenu.tsx`)

Контекстное меню открывается по нажатию **ПКМ** на персонаже и предоставляет пользователю доступ к действиям и настройкам.

### 4.1. Архитектура и зоны ответственности
1. **Группы действий:**
   * **Взаимодействие (Quick Actions):** Погладить (Pet), Поиграть (Play), Покормить (Feed), Уложить спать / Разбудить (Sleep/Wake).
   * **Настройки отображения:** Масштаб (Scale 0.75x..1.5x), Темы оформления (Themes), Автономное блуждание (Wander On/Off), Поверх всех окон (Always on Top).
   * **Системные функции:** Вернуть в центр экрана (Reset Position), Панель отладки (Debug HUD), Выход (Quit).
2. **Синхронизация размера окна с Main:**
   * При открытии меню вызывается `window.electronAPI.setMenuExpanded(true)`, расширяя область прозрачного окна для отрисовки карточки меню без обрезки.
   * При закрытии — `window.electronAPI.setMenuExpanded(false)`.
3. **Правила верстки и стиля:**
   * Стиль: Compact Glassmorphism (аккуратный полупрозрачный фон с размытием `backdrop-blur`, мягкие скругления, акцентная палитра в тон темы).
   * Меню не должно перекрывать лицо персонажа и позиционируется с учетом границ экрана.
   * Кликаут: клик в любую область за пределами меню закрывает его.

---

## 5. Спецификация диалоговых элементов (`SpeechBubble` & `ChatInput`)

1. **`SpeechBubble.tsx` (Облачко мыслей и речи):**
   * Отображает сообщения двух типов:
     * `pet`: прямая речь питомца (белое облачко с хвостиком).
     * `thought`: внутренние мысли (стилизованное облачко с кружочками-хвостиками).
   * Содержит таймер автоматического скрытия (auto-dismiss) через 4–6 секунд или кнопку закрытия по клику.
2. **`ChatInput.tsx` (Поле ввода чата):**
   * Открывается по **двойному клику (Double Click)** на персонаже или клику на ярлычок имени.
   * Отправляет введенный текст в `useDialogueLoop` (`aiProvider.generateResponse`), переключая питомца в состояние `thinking` на время ответа.

---

## 6. Потоки данных (Data Flow & IPC)

### 6.1. Входящий поток (Main ➔ UI)
Через подписку `window.electronAPI.onPetPresentationState(callback)` UI непрерывно получает актуальный снимок состояния:
```typescript
interface PetPresentationStateDTO {
  readonly revision: number;
  readonly motionPhase: PetMotionPhase;           // 'grounded' | 'airborne' | 'dragged' | 'surface_attached'
  readonly rootScreenPosition: ScreenPointDTO;    // Координаты на экране { x, y }
  readonly velocityPxPerSec: Vector2DDTO;         // Скорость { x, y }
  readonly animationState: AnyAnimationState;     // 'idle' | 'walk' | 'run' | 'fall' | 'land' | ...
  readonly lookDirection: GazeDirectionDTO;       // Направление взгляда
}
```

### 6.2. Исходящий поток ввода (UI ➔ Main)
При взаимодействии мышью UI отправляет только сырые события ввода:
```typescript
// Начало захвата
window.electronAPI.beginPetDrag({ pointerId, sequence: 0, screenPosition: { x, y } });

// Перемещение во время драга
window.electronAPI.movePetDrag({ dragSessionId, pointerId, sequence, screenPosition: { x, y } });

// Отпускание / бросок
window.electronAPI.releasePetDrag({ dragSessionId, pointerId, sequence, screenPosition: { x, y } });

// Клик / Поглаживание / Кормление
window.electronAPI.interactWithCharacter({ type: 'pet' | 'click' | 'feed' | 'play' });
```

---

## 7. Чеклист для AI-агентов и разработчиков UI

При внесении любых изменений в слой `src/renderer/`:

- [ ] **Изоляция:** В коде отсутствуют расчеты физики, таймеры гравитации и вызовы `setPosition`.
- [ ] **Манифест:** Ключи анимаций соответствуют `manifest.json` (никакого хардкода несуществующих имен файлов).
- [ ] **Оверлеи:** Слой лица рендерится только при `faceOverlay.mode === 'overlay'`.
- [ ] **Очистка ресурсов:** Все подписки `useEffect` (`window.electronAPI.on...`, слушатели `keydown`, таймеры) содержат обязательную функцию отписки в `return () => { ... }`.
- [ ] **Тестирование:** Команды `npm test` и `npm run typecheck` завершаются со 100% успехом.
