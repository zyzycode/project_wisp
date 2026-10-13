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

Direct finite reactions без Activity тоже ограничены Main deadline: click/feed/pet
и confused/spook — 3000 ms, wake — 1500 ms, land/crash — существующий landing
recovery. Deadline считается от текущего episode и работает при выключенном
wander; replay обновляет начало, новое forced/Activity состояние отменяет старое
окончание. Skin completion не участвует в этом решении.

Base playback ключ — `(streamId, visualIntent.episodeId)`, не Activity presence/revision. Каждый новый episode/replay задаёт Main `episodeStartedAtMs` и возрастающий `episodeSequence`, включая повторные click/land/direct reactions при `activity: null`. Прежний episode immutable и не рестартует от revision. Main создаёт уникальный ID из sequence и ограниченного factory suffix; Body проверяет sequence и текущий payload с O(1) памятью, без истории всех эпизодов ([UI §6](UI_SPEC.md#6-brain--body-ipc)).

Body вычисляет `BodyVisualState.visualAgeMs = sampledAtMs - episodeStartedAtMs`; Skin использует same-clock baseline, затем Renderer-monotonic delta для frames, без сравнения часов.

| Соотношение clip и Brain phase | Поведение Body/Skin | Последствие для Brain |
|---|---|---|
| Finite clip завершился раньше | Удержать terminal frame, повторить безопасный loop или перейти к локальному neutral fallback до новой revision. | Нет события и изменения cadence. |
| Brain phase сменилась раньше | Немедленно разрешить новый `BodyVisualState`; старый clip локально прерывается. | Уже перешёл по своим часам/event. |
| Asset/clip отсутствует или повреждён | Применить canonical fallback и локально залогировать bounded diagnostic. | Semantic phase продолжает штатный timeline. |
| Renderer завис, перезагрузился или уничтожен | Новый Body получает полный актуальный snapshot и начинает визуализацию с него. | Brain продолжает работать без animation watchdog. |

Completion callback только внутри SpriteSkinAdapter для local frame/fallback. Он не BodyEventDTO, не проходит Preload, не создаёт Activity completion/stimulus/opportunity.

Local neutral fallback действительно передаётся Skin с отдельным локальным
playback key и монотонной local revision, даже если fallback разрешается в тот же
body asset. Исходный Brain episode/DTO не изменяется и не публикуется обратно.

### Cadence текущих клипов

Legacy body art из четырёх кадров с default 5 FPS получает presentation-only
[профиль задержек](../../src/renderer/render-engine/clip-pacing.ts).
Явные отличающиеся durations, специализированные clips и debug exact-key inspection
сохраняют timing манифеста. Artwork, порядок кадров и anchors не меняются.
Значения ниже — длительность Skin cycle, не deadline Brain.

Для конечной Activity-фазы Body проецирует `phaseDurationMs` из её начала и
deadline. Legacy profile при необходимости пропорционально сокращается до 90%
этого бюджета: вступление доходит до последней позы, оставшееся время — terminal
hold. Loop clips, специализированный timing художника и Brain deadline не
меняются. Например, inspect 2200 получает cycle 1980 ms; floor rest prepare 1200
получает lie_down 1080 ms, затем отдельный sleep_start в settle вместо повторного
проигрывания lie_down. Позы prepare/settle явно конечны; sleep повторяется.

| Body clip | Cycle / задержки кадров, ms | Brain phase и повторения | Terminal pose |
|---|---|---|---|
| `body_idle`, `body_bored` | 2400 / 650, 550, 550, 650 | calm seeded 6500–9999; settle/yawn 3000; повтор только при `until_replaced` | Последний кадр для finite |
| `body_thinking` | 2400 / 500, 600, 700, 600 | expression 3000; повтор по intent | Последний кадр для finite |
| `body_look_around` | 2400 / 500, 650, 750, 500 | calm seeded 6500–9999 либо короткий notice/inspection; finite budget ограничивает cycle | Последний кадр для finite |
| `body_crouch_examine`, `body_edge_peek`, `body_surface_touch` | 2400 / 300, 500, 900, 700 | deadline inspection; без добавочных повторов | Последний кадр |
| `body_sleep_trans`, `body_lie`, `body_sit` | 2400 / 400, 650, 750, 600 | rest transition обычно 3000; без добавочных повторов | Последний кадр |
| `body_sleep` | 3000 / 750 × 4 | sleep loop до замены; rest 3000 или nap 12000 | Нет при loop |
| `body_petting`, `body_wave`, `body_celebrate`, `body_scared` | 1200 / 120, 180, 500, 400 | конечная реакция/социальная фаза; без добавочных повторов | Последний кадр либо разрешённый local fallback |
| `body_walk`, `body_run`, `body_climb_wall`, `body_ceiling_hang`, `body_dragged`, `body_fall` | 800 / 200 × 4 | повтор до motion transition; gait/скорость принадлежат Brain | Нет при loop |
| `body_land`, `body_stand_up`, `body_jump` | 800 / 200 × 4 | finite; Brain deadline/event независим | Последний кадр |
| `body_crash_splat` | 1600 / 200 × 8 | forced recovery | Последний кадр |
| `body_grab_edge`, `body_jump_travel`, `body_pull_up_edge` | 640, 640, 800 | traversal deadline/event, без добавочных повторов | Последний кадр |
| `body_sit_edge`, `body_sit_edge_sleep`, `body_sit_edge_settle` | 960, 2000, 1200 | rest choreography; повтор по intent | Последний кадр для finite |
| `body_cursor_play`, `body_cursor_caught`, `body_cursor_missed` | 720, 600, 600 | play до замены; reaction 600 однократно | Последний кадр reaction |

`none` и текущий `bounded` Skin проигрывают один cycle; `until_replaced` повторяет
его до нового intent. Terminal hold сам по себе не означает остановку Brain.
Короткие notice/land phases не удлиняются ради нового профиля.

Текущий `body_idle` — дыхание с отдельным лицевым слоем, без нарисованного
моргания. Его спокойный cycle не служит таймером blink. Отдельный нейтральный
blink требует готового художником face clip; нельзя подменять его `face_winking`
или переключением направлений `face_gaze`.

Body проецирует существующую authoritative velocity в локальный Skin state.
Loop locomotion продвигает playback clock пропорционально модулю скорости:
reference walk/hang — 90 px/s, run — 180, crawl — 45, climb — 220; rate ограничен
3×. Нулевая скорость удерживает walk на последнем готовом кадре с опорой ног,
run — на готовой idle-позе; climb/crawl удерживают текущую позу опоры.
Скрытая фаза шага сохраняется, при возобновлении движение не рестартует.
Native facing art нормализуется Skin: `body_walk` нарисован влево, `body_run`
вправо; Body хранит направление движения независимо от этого различия.
Изменение скорости не рестартует
episode и не пересчитывает уже пройденную фазу. После подключения Renderer
начальный playback age оценивается по текущей скорости: история скорости не
передаётся. Finite transitions, fall/drag и debug preview идут по обычному clock.
Визуальная оценка ритма на Windows остаётся отдельной проверкой; эта связь
cadence со скоростью не доказывает отсутствие скольжения в живом движении.

## 6. Superseded contract

[AUTO-A06](https://github.com/zyzycode/project_wisp/issues/31) superseded решением AUTO-A08 для animation-completion handshake. Удалить AnimationLifecycleResultDTO/terminal outcomes/animationRequestId/notifyAnimationLifecycleResult/pending-animation/watchdog целиком; compatibility period/parallel protocol запрещены. Exact BrainStateDTO/BodyEventDTO, order/atomic migration — [UI §6](UI_SPEC.md#6-brain--body-ipc).
