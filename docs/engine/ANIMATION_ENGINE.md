# Архитектура Animation Engine

`AnimationIntent` — семантический визуальный запрос после принятого решения о поведении. Он описывает желаемое визуальное состояние персонажа без привязки к конкретным спрайтам, кадрам, размерам текстур или платформенным API.

> [!NOTE]
> **Каталог в коде, ownership в contract:**
> Текущие интерфейсы, списки visual states и таблицы маппинга определены в коде ниже; границы Brain/Body/Skin, timeline и IPC определяет этот документ с `UI_SPEC.md`. Legacy lifecycle code мигрирует в AUTO-I07/AUTO-I08.
> - Структура намерения и категории: [`animation-intent.ts`](../../src/domain/animation/animation-intent.ts) (`AnimationIntent`, `AnimationIntentKind`, `AnimationPriority`).
> - FSM и конфигурация переходов: [`animation-state-machine.ts`](../../src/domain/animation/animation-state-machine.ts) (`AnimationStateMachine`, `ANIMATION_STATES`).

---

## 1. Поток ответственности Brain → Body → Skin

Animation Engine не принимает решений о поведении персонажа и не парсит сырые события окружения:

```text
Application mapper
  -> Candidate BehaviorIntent
  -> Character Engine
  -> Resolved BehaviorIntent
  -> Behavior Brain (для Activity-backed behavior)
  -> Activity Runner
  -> Brain activity timeline + semantic AnimationIntent
  -> BrainStateDTO
  -> Renderer Body Controller
  -> renderer-local BodyVisualState
  -> ISkinEngine / SpriteSkinAdapter
  -> Asset/Fallback Resolver -> AnimationPlayer -> ICharacterRenderer

Forced physical fact -> Motion Engine -> BrainStateDTO.motion
```

- **Character Engine**: Принимает или отклоняет поведение на основе потребностей (`Needs`), отношений (`Relationship`) и эмоций (`SynthesizedEmotionalTone`). Выдает `Resolved BehaviorIntent`.
- **Brain (Main/Application)**: Владеет semantic state, Activity timeline и authoritative motion projection. `ActivityRunner` формирует семантический `AnimationIntent` без знания файлов/кадров и переключает фазы по Main-monotonic времени либо authoritative causal events.
- **Motion Engine**: Фиксирует принудительные физические события (`MotionEvent` — падение, бросок, перетаскивание); Brain атомарно отражает их в Activity/motion/visual полях следующего `BrainStateDTO`.
- **Body Controller (Renderer)**: Принимает только возрастающие Brain revisions, проецирует их в renderer-local `BodyVisualState` и может добавить быстрые визуальные рефлексы (gaze, squash/stretch). Его visual FSM не является semantic FSM и не сообщает completion в Brain.
- **Skin (Renderer)**: `ISkinEngine` и единственный текущий `SpriteSkinAdapter` выбирают ассеты, воспроизводят кадры и рендерят. Ни clip, ни fallback не меняют Brain/Body semantic inputs.

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

Переход между visual states в Body разрешается локальным контроллером строго по уровням приоритета; эта таблица не меняет Brain Activity timeline:

| Приоритет | Состояния (примеры) | Политика прерывания | Правило вытеснения |
|---|---|---|---|
| `critical` | `dragged`, `falling`, `spook`, `crash_landing` | Не прерывается обычными запросами | Немедленно вытесняет любое другое состояние (`high`, `normal`, `low`). |
| `high` | `wake_up`, `landing`, `sleep_start`, `sleep_loop` | Защищено от повседневных реакций | Вытесняет `normal` и `low`. Может быть прервано только `critical` или штатным переходом жизненного цикла. |
| `normal` | `talking`, `thinking_loop`, `happy`, `surprised`, `walk`, `run` | Прерывается пользовательским вводом и физикой | Вытесняет `low`. Прерывается событиями `high` и `critical`. Не может нарушить устойчивый `sleep_loop`. |
| `low` | `idle_blink`, `settle`, `sit`, `bored` | Прерывается любым внешним запросом | Фоновые микро-движения и стабилизация. Уступают место любому входящему intent. |

### Базовые правила разрешения конфликтов:
1. **Физика и ввод пользователя первичны:** Перетаскивание (`dragged`), падение (`falling`) и клики мгновенно прерывают автономную ходьбу (`walk`), диалог (`talking`) и фоновый отдых.
2. **Сон изолирован:** Устойчивое состояние сна (`sleep_loop`) игнорирует `normal` и `low` события (включая блуждание, диалоговые реакции и таймеры моргания). Выход возможен только через `wake_up`, прямой пользовательский драг или `spook`.
3. **Временные реакции ограничены Brain phase:** Для `happy`, `surprised`, `spook` Brain публикует bounded phase/deadline, а Body применяет следующую revision. Локальное окончание клипа до deadline может лишь удержать terminal frame или fallback.

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

## 4. Граница Body / Render Engine

Brain передаёт Body только serializable semantic `visualIntent` внутри `BrainStateDTO`. Body формирует `BodyVisualState`, а Skin может внутри адаптера построить готовый кадр `RenderPresentationState`. Следующие детали реализации **изолированы внутри Renderer/Skin**:
- Файловые пути к ресурсам, геометрия нарезки спрайт-листов и UV-координаты;
- DOM/canvas/CSS, visual hitboxes и Renderer-monotonic frame timing;
- DPI/масштабирование visual resources и локальная композиция слоёв.

Authoritative root screen position приходит только из `BrainStateDTO.motion`. Нативные оконные handles, Electron/platform types и callbacks запрещены как в Body/Skin DTO, так и во всех Main/Application/Domain/Shared контрактах.

---

## 5. Независимые semantic и clip timelines

Brain никогда не ждёт фактического окончания Skin-клипа. Для time-bounded Activity phase `ActivityRunner` сохраняет `phaseStartedAtMs`/`phaseEndsAtMs` в Main-monotonic шкале и переходит дальше при `nowMs >= phaseEndsAtMs`. Locomotion, guard, forced motion и direct input могут завершить или прервать фазу только через свои authoritative Brain events.

Body привязывает base playback к `(streamId, visualIntent.episodeId)`, а не к Activity presence или Brain revision. Каждый новый episode начинает/replay-ит visual intent с Main-monotonic `episodeStartedAtMs`, включая повторные click/land/direct reactions при `activity: null`. Более новая revision с тем же episode сохраняет неизменный intent и не перезапускает клип. При приёме snapshot Body вычисляет `BodyVisualState.visualAgeMs = sampledAtMs - episodeStartedAtMs`; Skin принимает этот same-clock baseline, затем использует Renderer-monotonic delta только для выбора кадра и не сравнивает clocks напрямую.

| Соотношение clip и Brain phase | Поведение Body/Skin | Последствие для Brain |
|---|---|---|
| Finite clip завершился раньше | Удержать terminal frame, повторить безопасный loop или перейти к локальному neutral fallback до новой revision. | Нет события и изменения cadence. |
| Brain phase сменилась раньше | Немедленно разрешить новый `BodyVisualState`; старый clip локально прерывается. | Уже перешёл по своим часам/event. |
| Asset/clip отсутствует или повреждён | Применить canonical fallback и локально залогировать bounded diagnostic. | Semantic phase продолжает штатный timeline. |
| Renderer завис, перезагрузился или уничтожен | Новый Body получает полный актуальный snapshot и начинает визуализацию с него. | Brain продолжает работать без animation watchdog. |

Visual completion callback допустим только внутри `SpriteSkinAdapter` для локального frame/fallback перехода. Он не входит в `BodyEventDTO`, не пересекает Preload и не создаёт Activity completion, stimulus или autonomy opportunity.

## 6. Superseded contract

[AUTO-A06](https://github.com/zyzycode/project_wisp/issues/31) **superseded** решением AUTO-A08 в части animation-completion handshake. Целевой runtime удаляет `AnimationLifecycleResultDTO`, terminal outcomes, `animationRequestId`, `notifyAnimationLifecycleResult`, pending-animation state и watchdog целиком; compatibility period и второй параллельный protocol запрещены. Точные `BrainStateDTO` / `BodyEventDTO`, ordering и атомарный migration path заданы в [`UI_SPEC.md`](./UI_SPEC.md#6-brain--body-ipc).
