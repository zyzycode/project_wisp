# Архитектурный бриф UI / Renderer

`UI_SPEC.md` — архитектурный бриф UI-слоя Project Wisp. Документ фиксирует UX-принципы приложения-компаньона, правила взаимодействия окна с операционной системой, границы ответственности (ownership) и поток данных между процессами.

> [!NOTE]
> **Источник правды (Single Source of Truth):**  
> Спецификация не дублирует стили, точные пиксельные размеры, цветовую палитру и DOM-структуру компонентов. Источником правды для разметки, стилизации и композиции является React-код и CSS в каталоге [`src/renderer/`](../../src/renderer/).

---

## 1. Поток данных и границы ответственности (Ownership)

UI функционирует по модели однонаправленного потока данных (Unidirectional Data Flow):

```mermaid
flowchart LR
  Main[Main Process / Domain] -->|Immutable Presentation DTO| Preload[Typed window.wispAPI]
  Preload --> Store[Renderer Presentation State]
  Store --> UI[React Surfaces]
  UI -->|Semantic User Intent| Preload
  Preload --> Main
```

| Область | Авторитетный владелец | Зона ответственности Renderer | Запрещено в Renderer |
|---|---|---|---|
| **Поведение и состояние** | Domain / Character Engine | Отображение проекции (`presentation-ready snapshot`, статус, эмоция). | Вычисление потребностей (`Needs`), принятие решений о поведении или FSM-переходах. |
| **Окно и ОС** | Main + Platform Adapters | Отправка семантических намерений окна (изменение размера, режима). | Прямое управление нативным окном Electron, чтение переменных среды ОС или платформы. |
| **Позиция персонажа** | Motion Engine / Main | Отображение персонажа по координатам проекции. | Авторитетный расчёт физики движения, гравитации и кинематики. |
| **Типизированный мост** | Preload (`window.wispAPI`) | Вызов строго типизированных методов API и подписка на события. | Использование `ipcRenderer`, доступ к Node.js API, знание имён каналов IPC. |
| **Локальный UI-контекст** | React Surfaces | Черновик ввода чата, фокус, открытость меню/табов, ховер. | Превращение временного UI-состояния в персистентное без подтверждения Main. |

---

## 2. UX-принцип: Прозрачное окно-оверлей (Transparent Overlay)

1. **Бесшовное присутствие на рабочем столе:**
   - Окно персонажа работает в режиме прозрачного безрамочного оверлея (`frameless`, `transparent`, без теней окна и без отображения в панели задач).
   - Персонаж визуально существует прямо на рабочем столе поверх окон других приложений (`always-on-top`).
2. **Динамическая поверхность окна:**
   - В базовом режиме размер окна минимизирован до компактных границ самого персонажа и всплывающих мыслей.
   - При открытии расширенных интерфейсов (контекстное меню, диалоговый чат, HUD) размер нативного окна динамически адаптируется под габариты открытой поверхности через координацию с Main-процессом, предотвращая обрезку контента.
3. **Безопасность границ экрана (Clamping & Viewport Awareness):**
   - Все всплывающие элементы (облака диалога, меню) позиционируются относительно персонажа с обязательным учётом экранных границ (`workArea`), чтобы элементы интерфейса никогда не выходили за пределы видимости дисплея.

---

## 3. UX-принцип: Клик сквозь окно (Ignore Mouse Events)

Главная цель — **ненавязчивость (non-intrusive presence)**: оверлей не должен блокировать взаимодействие пользователя с его рабочим окружением и окнами сторонних приложений.

1. **Сквозной клик по умолчанию:**
   - Любая область окна, где отсутствует активный UI-элемент (полностью прозрачные пиксели холста), пропускает клики и события мыши насквозь к окнам под оверлеем (`window.setIgnoreMouseEvents(true, { forward: true })`).
2. **Интерактивные зоны (Hit-testing):**
   - События мыши перехватываются (`setIgnoreMouseEvents(false)`) исключительно при наведении курсора на интерактивные поверхности:
     - Сам спрайт/хитбокс персонажа;
     - Всплывающие диалоговые облака (Speech/Thought bubbles);
     - Поле ввода чата;
     - Контекстное меню и элементы панели отладки.
3. **Перетаскивание персонажа (Pointer Drag Lifecycle):**
   - Зажатие левой кнопки мыши на персонаже с преодолением порога смещения переводит систему в режим перетаскивания (Drag).
   - Renderer захватывает события указателя и передаёт нормализованный поток координат в Main-процесс. Авторитетное перемещение окна и физику броска/падения рассчитывает Motion Engine.

---

## 4. UX-принцип: Поведение контекстного меню (Context Menu)

Контекстное меню предоставляет доступ к управлению персонажем, настройкам и режимам взаимодействия.

1. **Жизненный цикл открытия и закрытия:**
   - **Открытие:** по правому клику (контекстному нажатию) на персонаже.
   - **Закрытие:** по клику вне области меню (outside click / backdrop click), по нажатию клавиши `Escape` или после выбора терминального действия (например, "Выйти").
   - При открытии меню окно автоматически переводится в интерактивный режим и расширяет рабочую область; при закрытии — возвращается в компактное состояние.
2. **Иерархия действий:**
   - **Взаимодействие (Interactions):** прямые семантические стимулы (погладить, покормить, поиграть, подумать).
   - **Жизненный цикл (Vitality):** явные команды перехода в сон и пробуждения (`sleep` / `wake`).
   - **Автономия (Autonomy):** включение/выключение свободного перемещения персонажа по экрану (прогулка).
   - **Персонализация:** выбор визуальной темы, ручная смена выражений и масштаба персонажа.
   - **Системные контролы:** сброс позиции персонажа в центр рабочего стола, закрепление поверх окон, выход из приложения.
3. **Изоляция Debug-интерфейса:**
   - Вкладка/панель телеметрии (`Debug HUD`) доступна исключительно при наличии явного флага/возможности `debugEnabled`.
   - В production-режиме отладочные элементы полностью исключаются из рендера, а не маскируются через CSS.

---

## 5. Инварианты безопасности и приватности

1. **Изоляция окружения:** Renderer функционирует в режиме строгой изоляции (`contextIsolation: true`, `sandbox: true`).
2. **Отсутствие доступа к приватным данным:** Renderer не имеет доступа к локальной файловой системе, SQLite, системным промптам нейросетей, API-ключам и полным слепкам памяти персонажа.
3. **Семантические намерения:** Любое действие пользователя из UI формирует высокоуровневый семантический интент (User Intent DTO), отправляемый через `window.wispAPI`. UI не имеет права напрямую мутировать внутреннее состояние движков ядра.

---

## 6. Animation lifecycle result IPC

Renderer сообщает Main только terminal результат уже выданного presentation request. Контракт не передаёт `BehaviorIntent`, не позволяет Renderer выбрать следующий visual/semantic state и не даёт ему authority над autonomy cadence.

### 6.1. Shared DTO

DTO результатов жизненного цикла анимации и событий окна типизированы в [src/shared/ipc-contracts.ts](../../src/shared/ipc-contracts.ts).

Краткое описание значений исхода:
- `completed` (анимация доиграла до конца);
- `interrupted` (прервана более приоритетным событием);
- `failed` (ошибка кадра/ассета).

`animationRequestId` присутствует только у request, terminal lifecycle которого ожидает Main. Это уникальный непустой opaque ID, создаваемый Main и стабильный на всех повторных presentation snapshots одного request. `revision` продолжает упорядочивать снапшоты и не заменяет request ID.

### 6.2. Направление и channel

```text
Main --PetPresentationStateDTO--> typed Preload subscription --> Renderer
Renderer --notifyAnimationLifecycleResult(result)--> fixed Preload invoke
         --wisp:animation-lifecycle-result--> Main validation/consumer
```

Preload экспортирует только точечный метод `notifyAnimationLifecycleResult`; raw `ipcRenderer`, generic `send` / `invoke` и динамическое имя канала запрещены. `Promise<void>` подтверждает только validation и доставку result handler, но не semantic acceptance и не факт возобновления cadence.

### 6.3. Main validation и idempotency

Main handler принимает `unknown` и до вызова lifecycle consumer проверяет:

1. sender совпадает с актуальным trusted `BrowserWindow.webContents` и окно не уничтожено;
2. payload является plain non-null object ровно с полями `requestId` и `outcome`;
3. `requestId` — непустая строка допустимой bounded длины;
4. `outcome` равен только `completed`, `interrupted` или `rejected`;
5. validated данные скопированы в новый DTO; raw object и extra fields дальше не передаются.

Malformed payload отклоняется до Application/Main composition. Валидный stale, foreign или duplicate `requestId` является идемпотентным no-op: он не меняет presentation, Character/Motion state, pending interaction или cadence.

Matching result атомарно снимает pending request и очищает его watchdog. Дальнейшее действие определяется сохранённым Main context, а не данными Renderer:

| Outcome | Main handling |
|---|---|
| `completed` | Зафиксировать подтверждённый visual terminal outcome и вызвать ровно один guarded continuation. |
| `interrupted` | Не продолжать старый flow; replacement/forced lifecycle остаётся владельцем дальнейшего состояния. |
| `rejected` | Завершить request как failed и выполнить safe recovery через свежие authoritative gates. |

Новый Main request инвалидирует старый ID до публикации replacement. Stop/dispose/window destruction также инвалидируют pending ID. Watchdog semantics и источник фактического completion определены в [`ANIMATION_ENGINE.md`](./ANIMATION_ENGINE.md#5-коррелированный-lifecycle-транзитной-анимации).

### 6.4. Interaction и cadence boundary

Accepted user interaction, запустившая транзитную анимацию, удерживает autonomy suspension до matching terminal result либо Main-owned cancellation/timeout recovery. Blanket immediate resume после отправки interaction запрещён.

Rejected/no-visual interaction может завершиться синхронно. Любое последующее scheduling всё равно проходит через единый coordinator helper, который отменяет старый timer и проверяет свежие Character eligibility, Motion authority, menu и enabled state. Renderer lifecycle result не создаёт autonomy opportunity и не является вторым scheduler.
