# Архитектура Animation Engine

`AnimationIntent` — семантический визуальный запрос после принятого решения о поведении. Он описывает желаемое визуальное состояние персонажа без привязки к конкретным спрайтам, кадрам, размерам текстур или платформенным API.

> [!NOTE]
> **Source of Truth в коде:**
> Полные контракты интерфейсов, списки состояний и таблицы маппинга определены непосредственно в коде:
> - Структура намерения и категории: [`animation-intent.ts`](../../src/domain/animation/animation-intent.ts) (`AnimationIntent`, `AnimationIntentKind`, `AnimationPriority`).
> - FSM и конфигурация переходов: [`animation-state-machine.ts`](../../src/domain/animation/animation-state-machine.ts) (`AnimationStateMachine`, `ANIMATION_STATES`).

---

## 1. Поток ответственности (Кто решает, какой спрайт показать)

Animation Engine не принимает решений о поведении персонажа и не парсит сырые события окружения:

```text
Application mapper
  -> Candidate BehaviorIntent
  -> Character Engine
  -> Resolved BehaviorIntent
  -> Behavior Brain (для Activity-backed behavior)
  -> Activity Runner
  -> AnimationIntent
  -> Animation Controller (FSM)
  -> Asset/Fallback Resolver
  -> AnimationPlayer
  -> RenderPresentationState
  -> ICharacterRenderer

Forced physical fact -> Motion Engine -> MotionEvent -> same Animation Controller
```

- **Character Engine**: Принимает или отклоняет поведение на основе потребностей (`Needs`), отношений (`Relationship`) и эмоций (`SynthesizedEmotionalTone`). Выдает `Resolved BehaviorIntent`.
- **Activity Runner**: Преобразует поведение в семантический `AnimationIntent` (без знания файлов и кадров).
- **Motion Engine**: Фиксирует принудительные физические события (`MotionEvent` — падение, бросок, перетаскивание) и направляет их напрямую в контроллер анимации.
- **Animation Controller (`AnimationStateMachine`)**: Управляет FSM, сверяет приоритеты, проверяет возможность прерывания (`interrupt`), координирует тайминги и жизненный цикл состояний.
- **Asset / Fallback Resolver**: Сопоставляет семантическое состояние с доступными ассетами пакета (спрайты, оверлеи эмоций/реквизита) и выполняет fallback при их отсутствии.
- **AnimationPlayer**: Управляет тиками кадров (delta timing, текущий индекс кадра) и формирует плоский `RenderPresentationState`.
- **ICharacterRenderer**: Детерминированно отрисовывает подготовленный стейт на экране (например, через `ReactSpriteRenderer`).

### Граница MotionEvent (Физические воздействия)

Принудительное движение управляется физикой, обходит выбор Activity и поступает в тот же контроллер анимации:

| Событие Motion Engine | Целевое состояние FSM | Приоритет и прерывание |
|---|---|---|
| `drag_started` | `dragged` | `critical`, непрерываемый |
| `airborne_started` (бросок / потеря опоры / прыжок) | `falling` / `fall` | `critical` / `high`, прерывает обычные действия |
| `landed: soft_landing` | `landing` -> `settle` | `high`, ограниченный по времени |
| `landed: stumble` | `stumble` -> `settle` | `high`, ограниченный по времени |
| `landed: crash_landing` | `crash_landing` -> `recover` -> `settle` | `critical` / `high` |

---

## 2. Матрица приоритетов и прерываний

Переход между анимационными состояниями разрешается контроллером строго по уровням приоритета:

| Приоритет | Состояния (примеры) | Политика прерывания | Правило вытеснения |
|---|---|---|---|
| `critical` | `dragged`, `falling`, `spook`, `crash_landing` | Не прерывается обычными запросами | Немедленно вытесняет любое другое состояние (`high`, `normal`, `low`). |
| `high` | `wake_up`, `landing`, `sleep_start`, `sleep_loop` | Защищено от повседневных реакций | Вытесняет `normal` и `low`. Может быть прервано только `critical` или штатным переходом жизненного цикла. |
| `normal` | `talking`, `thinking_loop`, `happy`, `surprised`, `walk`, `run` | Прерывается пользовательским вводом и физикой | Вытесняет `low`. Прерывается событиями `high` и `critical`. Не может нарушить устойчивый `sleep_loop`. |
| `low` | `idle_blink`, `settle`, `sit`, `bored` | Прерывается любым внешним запросом | Фоновые микро-движения и стабилизация. Уступают место любому входящему intent. |

### Базовые правила разрешения конфликтов:
1. **Физика и ввод пользователя первичны:** Перетаскивание (`dragged`), падение (`falling`) и клики мгновенно прерывают автономную ходьбу (`walk`), диалог (`talking`) и фоновый отдых.
2. **Сон изолирован:** Устойчивое состояние сна (`sleep_loop`) игнорирует `normal` и `low` события (включая блуждание, диалоговые реакции и таймеры моргания). Выход возможен только через `wake_up`, прямой пользовательский драг или `spook`.
3. **Временные реакции самоограничены:** Состояния с ограниченной длительностью (`happy`, `surprised`, `spook`) после завершения автоматически переходят в целевое устойчивое состояние (обычно `idle`, а во время сна — `sleep_loop`).

---

## 3. Базовые правила Fallback (Graceful Degradation)

Отсутствие отдельных графических кадров никогда не должно приводить к крашу FSM или рассинхрону логики персонажа. Разрешение ассетов происходит в три уровня:

| Уровень | Условие | Поведение Resolver / Controller | Гарантия |
|---|---|---|---|
| **Level 1** | Доступен точный арт под `kind + emotionalTone + hints`. | Отрисовывается специализированный спрайт/оверлей (например, уникальный румянец при смущении). | Максимально богатая визуализация семантики. |
| **Level 2** | Точного варианта нет, но есть базовый цикл категории. | Воспроизводится базовый цикл тела (`body_idle`, `body_walk`) с наложением независимого доступного слоя эмоции/реквизита. | Семантические оверлеи (сердечко, вопрос, румянец) деградируют независимо от анимации тела. |
| **Level 3** | Отсутствует безопасный арт категории или слоя. | Откат к базовому `idle_blink` с нейтральной мимикой (`expressionHint: 'idle'`, `propHint: 'none'`). | FSM сохраняет согласованность шагов и переходов, логический цикл не ломается. |

### Инварианты Fallback:
- Fallback меняет исключительно визуальное представление, но **не переписывает исходный `BehaviorIntent`** в логике персонажа.
- Fallback **не повышает эмоциональную экспрессивность**: если нет спрайта `shy`, персонаж откатывается к `idle`, но не заменяется на `affectionate`.
- При отсутствии специализированного спрайта для `sleep_loop` персонаж визуально замирает в самом спокойном доступном состоянии, но логически **остается спящим**.

---

## 4. Граница Render Engine

Animation Engine передает в Render Engine только готовый кадр `RenderPresentationState`. Следующие детали реализации **изолированы внутри Render Engine**:
- Файловые пути к ресурсам, геометрия нарезки спрайт-листов и UV-координаты;
- DOM/CSS классы, DPI/масштабирование и нативные оконные хэндлы Electron;
- Физические координаты экрана и хитбоксы курсора (определяются в [`MOTION_ENGINE.md`](./MOTION_ENGINE.md)).

---

## 5. Коррелированный lifecycle транзитной анимации

Когда Application должна ждать окончания транзитной анимации перед продолжением Activity или autonomy cadence, Main публикует presentation request с уникальным `animationRequestId`. Этот идентификатор создаёт Main; Renderer только возвращает его в lifecycle result. `PetPresentationStateDTO.revision` остаётся порядком снапшотов и не используется для корреляции: несколько motion-снапшотов могут относиться к одному animation request.

Единственный нормальный completion flow:

```text
Main presentation request + animationRequestId
  -> Renderer Animation FSM принимает либо отклоняет переход
  -> Asset/Fallback Resolver выбирает клип
  -> AnimationPlayer воспроизводит клип по RAF/monotonic delta
  -> AnimationPlayer completion поступает в ту же FSM
  -> FSM выполняет штатный переход в ожидаемое stable state
  -> Renderer сообщает Main terminal lifecycle result с тем же requestId
```

AnimationPlayer владеет фактом окончания фактически выбранного finite clip, включая безопасный fallback; FSM владеет допустимостью перехода и следующим visual state. Проверка только имени текущего состояния, React timer или копия `durationMs` в Main не являются completion.

| Outcome Renderer | Условие | Последствие в Main |
|---|---|---|
| `completed` | Request принят, finite clip завершён, FSM вошла в штатное terminal state | Завершить совпавшее ожидание и выполнить один guarded continuation. |
| `interrupted` | Принятый request заменён более новым presentation request или forced visual event до normal completion | Не продолжать старый flow; новый request/forced lifecycle уже владеет дальнейшим ожиданием. |
| `rejected` | FSM не приняла входной переход либо playback не смог стартовать даже через canonical fallback | Завершить совпавшее ожидание как failed и применить Main-owned recovery policy без подмены semantic decision. |

Правила lifecycle:

- В Main одновременно существует не более одного pending animation request для одного presentation owner. Новый authoritative request сначала инвалидирует прежний ID, затем публикуется.
- Повторный снапшот с тем же `animationRequestId` не перезапускает клип. Один ID никогда не переиспользуется для другого visual request.
- Renderer сообщает terminal result не более одного раза для принятого ID. Main всё равно обрабатывает result идемпотентно: stale, foreign и duplicate ID не меняют state, cadence или Activity.
- `interrupted` старого ID не возобновляет cadence. `rejected` и `completed` проходят через текущий operational continuation и свежие Character/Motion/menu/enabled gates; result сам по себе не является behavior intent.
- Semantic `sleep` / `wake`, Needs и acceptance остаются Character-owned. Lifecycle result подтверждает только визуальное исполнение и не может менять Character или Motion state.

### Safety watchdog

Main может держать bounded watchdog для renderer crash/hang, но timeout является внутренним operational outcome `timed_out`, а не `completed` и не четвёртым Renderer outcome. Watchdog:

- не содержит и не копирует длительность клипа;
- проверяет тот же pending request ID и после срабатывания инвалидирует его;
- фиксирует diagnostic timeout и запускает safe recovery/resync;
- продолжает cadence только через свежие eligibility gates и не обходит forced motion, menu pause, disabled autonomy или semantic sleep;
- очищается при matching terminal result, interruption/replacement, stop, dispose и уничтожении окна.

Точная IPC-форма, направление вызова и validation определены в [`UI_SPEC.md`](./UI_SPEC.md#6-animation-lifecycle-result-ipc).
