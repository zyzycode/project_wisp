# Архитектура Animation Engine

`AnimationIntent` — semantic visual request после behavior decision, без sprites/frames/texture sizes/platform APIs. Каталог/типы — [animation-intent.ts](../../src/domain/animation/animation-intent.ts) (`AnimationIntentKind`, `AnimationPriority`); FSM — [animation-state-machine.ts](../../src/domain/animation/animation-state-machine.ts) (`AnimationStateMachine`, `ANIMATION_STATES`). Ownership/timeline/IPC — здесь и в UI_SPEC; legacy lifecycle мигрирует AUTO-I07/AUTO-I08.

<a id="поток-ответственности"></a>

## 1. Поток ответственности Brain → Body → Skin

Mapper → candidate BehaviorIntent → Character → resolved intent → Behavior Brain (Activity-backed) → Runner → Brain timeline/AnimationIntent → BrainStateDTO → Body Controller → BodyVisualState → ISkinEngine/SpriteSkinAdapter → Resolver/AnimationPlayer/ICharacterRenderer.

Character разрешает behavior по Needs/Relationship/SynthesizedEmotionalTone. Brain владеет semantic state/Activity timeline/authoritative motion; Runner не знает assets/frames. MotionEvent атомарно отражается в Activity/motion/visual полях snapshot. Body принимает возрастающие revisions, добавляет local gaze/squash-stretch; visual FSM не semantic FSM, completion обратно не отправляет. Skin воспроизводит assets/fallback, не меняя Brain/Body inputs. Raw environment events Animation не парсит.

### Граница MotionEvent (Физические воздействия)

Forced physics обходит Activity selection и идёт в тот же animation controller:

| Событие Motion Engine | Целевое состояние FSM | Приоритет и прерывание |
|---|---|---|
| `drag_started` | `dragged` | `critical`, непрерываемый |
| `airborne_started` (бросок / потеря опоры / прыжок) | `falling` / `fall` | `critical` / `high`, прерывает обычные действия |
| `landed: soft_landing` | `landing` -> `settle` | `high`, ограниченный по времени |
| `landed: stumble` | `stumble` -> `settle` | `high`, ограниченный по времени |
| `landed: crash_landing` | `crash_landing` -> `recover` -> `settle` | `critical` / `high` |

## 2. Матрица приоритетов и прерываний

Body разрешает visual states локально; таблица не меняет Brain timeline.

| Приоритет | Состояния (примеры) | Политика прерывания | Правило вытеснения |
|---|---|---|---|
| `critical` | `dragged`, `falling`, `spook`, `crash_landing` | Не прерывается обычными запросами | Немедленно вытесняет любое другое состояние (`high`, `normal`, `low`). |
| `high` | `wake_up`, `landing`, `sleep_start`, `sleep_loop` | Защищено от повседневных реакций | Вытесняет `normal` и `low`. Может быть прервано только `critical` или штатным переходом жизненного цикла. |
| `normal` | `talking`, `thinking_loop`, `happy`, `surprised`, `walk`, `run` | Прерывается пользовательским вводом и физикой | Вытесняет `low`. Прерывается событиями `high` и `critical`. Не может нарушить устойчивый `sleep_loop`. |
| `low` | `idle_blink`, `settle`, `sit`, `bored` | Прерывается любым внешним запросом | Фоновые микро-движения и стабилизация. Уступают место любому входящему intent. |

<a id="витальный-сон-и-пробуждение"></a>

### Базовые правила разрешения конфликтов:

Drag/fall/click прерывают walk/talking/background rest. Stable sleep_loop игнорирует normal/low, включая wander/dialogue/blink; выход только wake_up, direct drag или spook. Happy/surprised/spook имеют bounded Brain phase/deadline; Body применяет следующую revision, раннее clip completion только держит terminal frame/fallback.

## 3. Базовые правила Fallback (Graceful Degradation)

Missing frames не должны ломать FSM/semantic progression:

| Уровень | Условие | Поведение Resolver / Controller | Гарантия |
|---|---|---|---|
| **Level 1** | Доступен точный арт под `kind + emotionalTone + hints`. | Отрисовывается специализированный спрайт/оверлей (например, уникальный румянец при смущении). | Максимально богатая визуализация семантики. |
| **Level 2** | Точного варианта нет, но есть базовый цикл категории. | Воспроизводится базовый цикл тела (`body_idle`, `body_walk`) с наложением независимого доступного слоя эмоции/реквизита. | Семантические оверлеи (сердечко, вопрос, румянец) деградируют независимо от анимации тела. |
| **Level 3** | Отсутствует безопасный арт категории или слоя. | Откат к базовому `idle_blink` с нейтральной мимикой (`expressionHint: 'idle'`, `propHint: 'none'`). | FSM сохраняет согласованность шагов и переходов, логический цикл не ломается. |

### Инварианты Fallback:

Меняется только visual, не исходный BehaviorIntent. Экспрессивность не повышается: shy→idle, не affectionate. Без sleep_loop art используется самая спокойная доступная поза, semantic sleep сохраняется.

## 4. Граница Body / Render Engine

Brain передаёт serializable `visualIntent` в BrainStateDTO; Body → BodyVisualState; Skin → локальный RenderPresentationState. Только Renderer/Skin знают asset paths/slicing/UV, DOM/canvas/CSS/hitboxes/frame timing, DPI/visual scale/layers.

Authoritative root — только `BrainStateDTO.motion`. Native window handles, Electron/platform types/callbacks не входят в Body/Skin DTO и Main/Application/Domain/Shared contracts.

## 5. Независимые semantic и clip timelines

Фоновые `idle_blink`, `look_around`, `settle`, `sit` и `sit_edge` не наследуют
эмоциональные оверлеи из постоянного Mood: default — `expressionHint: idle`,
`propHint: none`. Body/Skin использует локальный gaze; явный expression hint
конкретной реакции сохраняет приоритет. После реакции фоновая поза снова нейтральна.
Cursor observation остаётся доступным во время обеих поз Activity `calm`.

Brain не ждёт Skin: bounded ActivityRunner phase имеет Main-monotonic phaseStartedAtMs/phaseEndsAtMs и transition при `nowMs >= phaseEndsAtMs`; locomotion/guard/forced motion/input завершают или прерывают через authoritative Brain events.

Base playback ключ — `(streamId, visualIntent.episodeId)`, не Activity presence/revision. Каждый новый episode/replay задаёт Main `episodeStartedAtMs`, включая повторные click/land/direct reactions при `activity: null`. Прежний episode immutable и не рестартует от revision.

Body вычисляет `BodyVisualState.visualAgeMs = sampledAtMs - episodeStartedAtMs`; Skin использует same-clock baseline, затем Renderer-monotonic delta для frames, без сравнения часов.

| Соотношение clip и Brain phase | Поведение Body/Skin | Последствие для Brain |
|---|---|---|
| Finite clip завершился раньше | Удержать terminal frame, повторить безопасный loop или перейти к локальному neutral fallback до новой revision. | Нет события и изменения cadence. |
| Brain phase сменилась раньше | Немедленно разрешить новый `BodyVisualState`; старый clip локально прерывается. | Уже перешёл по своим часам/event. |
| Asset/clip отсутствует или повреждён | Применить canonical fallback и локально залогировать bounded diagnostic. | Semantic phase продолжает штатный timeline. |
| Renderer завис, перезагрузился или уничтожен | Новый Body получает полный актуальный snapshot и начинает визуализацию с него. | Brain продолжает работать без animation watchdog. |

Completion callback только внутри SpriteSkinAdapter для local frame/fallback. Он не BodyEventDTO, не проходит Preload, не создаёт Activity completion/stimulus/opportunity.

## 6. Superseded contract

[AUTO-A06](https://github.com/zyzycode/project_wisp/issues/31) superseded решением AUTO-A08 для animation-completion handshake. Удалить AnimationLifecycleResultDTO/terminal outcomes/animationRequestId/notifyAnimationLifecycleResult/pending-animation/watchdog целиком; compatibility period/parallel protocol запрещены. Exact BrainStateDTO/BodyEventDTO, order/atomic migration — [UI §6](UI_SPEC.md#6-brain--body-ipc).
