# Архитектурный бриф UI / Renderer

UX, ownership и межпроцессный обмен. Разметка, стили, размеры и композиция определены в [src/renderer/](../../src/renderer), а не в этом контракте.

## 1. Поток данных и границы ответственности (Ownership)

```mermaid
flowchart LR
  Brain[Brain: Main / Application / Domain engines] -->|BrainStateDTO| Preload[Typed window.wispAPI]
  Preload --> Body[Body: Renderer presentation + input]
  Body -->|BodyVisualState| Skin[Skin: ISkinEngine]
  Skin --> UI[Sprite / React surfaces]
  Body -->|BodyEventDTO| Preload
  Preload --> Brain
```

| Область | Авторитетный владелец | Зона ответственности Renderer | Запрещено в Renderer |
|---|---|---|---|
| **Brain: поведение и состояние** | Main/Application + чистые Domain engines | Потребление ordered `BrainStateDTO`; отображение activity/mood/motion projection. | Вычисление `Needs`, планирование behavior/Activity, semantic FSM-переходы или ожидание Skin completion. |
| **Body: presentation и input** | Renderer `PetBodyController` | Локальный `BodyVisualState`, input capture, gaze и squash/stretch на RAF, cleanup. | Изменение Brain state, physics/position authority, frame-driven visual/reflex IPC и создание autonomy cadence. |
| **Skin: визуальный adapter** | Renderer-local `ISkinEngine` | Asset/fallback resolution, clip/frame timing и render resources. | IPC, semantic decisions, stimuli и доступ к Main/Application/Domain services. |
| **Окно и ОС** | Main + Platform Adapters | Отправка семантических намерений окна (изменение размера, режима). | Прямое управление нативным окном Electron, чтение переменных среды ОС или платформы. |
| **Позиция персонажа** | Motion Engine / Main | Отображение персонажа по координатам проекции. | Авторитетный расчёт физики движения, гравитации и кинематики. |
| **Типизированный мост** | Preload (`window.wispAPI`) | Вызов строго типизированных методов API и подписка на события. | Использование `ipcRenderer`, доступ к Node.js API, знание имён каналов IPC. |
| **Локальный UI-контекст** | React Surfaces | Черновик ввода чата, фокус, открытость меню/табов, ховер. | Превращение временного UI-состояния в персистентное без подтверждения Main. |

## 2. UX-принцип: Прозрачное окно-оверлей (Transparent Overlay)

Окно — transparent/frameless, без теней и taskbar, always-on-top. Базовые границы компактны: персонаж и мысли. Меню/chat/HUD расширяют нативную поверхность через Main без обрезки; всплывающие элементы привязаны к персонажу и clamped в `workArea`.

## 3. UX-принцип: Клик сквозь окно (Ignore Mouse Events)

Прозрачная неактивная область пропускает ввод: `window.setIgnoreMouseEvents(true, { forward: true })`. Захват (`setIgnoreMouseEvents(false)`) разрешён только над sprite/hitbox, Speech/Thought bubbles, chat input, menu/debug controls.

Левая кнопка на персонаже + порог смещения начинают Drag. Renderer захватывает pointer и передаёт normalized coordinates; перемещение окна, throw/fall physics принадлежат Motion Engine.

## 4. UX-принцип: Поведение контекстного меню (Context Menu)

Правый клик открывает меню и расширяет окно/включает interactive mode. Outside/backdrop click, `Escape` или terminal action закрывают его и возвращают компактное окно.

Открытое меню приостанавливает автономный выбор и отменяет текущую автономную Activity/voluntary movement через существующее `menu_visibility_changed`. Закрытие снимает только блокировку меню, сохраняя настройки autonomy enabled и quiet. Ввод до первого Brain snapshot сохраняет последнее состояние видимости для отправки после подключения.

Просмотр анимаций использует каталог загруженного manifest и существующий локальный Skin inspector: выбор body/face, повтор с начала и переключатель зацикливания. Его время воспроизведения не зависит от Brain episode; просмотр не меняет semantic FSM/Needs/physics и не отправляет completion в Main. Закрытие меню сбрасывает просмотр; явные interactions/sleep/wake также снимают preview перед отправкой команды. «Подумать» оставляет меню открытым.

Группы действий: interactions (погладить/кормить/играть/думать), `sleep`/`wake`, autonomy movement, theme/expression/scale, reset position/always-on-top/quit. Debug HUD требует явного `debugEnabled`; в production исключён из render, не скрыт CSS.

## 5. Инварианты безопасности и приватности

Общие Electron/security правила — [frontend/AGENTS.md](../../AGENTS.md#3-безопасность-electron-и-ipc). Renderer не получает файлы, SQLite, system prompts, API-ключи или полный memory snapshot. User actions идут semantic DTO через `window.wispAPI`, без прямой мутации engines.

<a id="6-brain--body-ipc"></a>
## 6. Brain → Body IPC

`BrainStateDTO` — единственный полный Main → Renderer state stream; `BodyEventDTO` — ограниченный input/observation stream обратно. Типы: [ipc-contracts.ts](../../src/shared/ipc-contracts.ts). Shared не импортирует Domain, React, DOM/canvas, Electron или Skin. Target declarations сами не включают runtime-каналы; cutover — §6.6.

### 6.1. Shared DTO

| Контракт / поле | Назначение | Инвариант |
|---|---|---|
| `BrainEmotionalToneDTO` | Синтезированный эмоциональный тон | Только literal variants, объявленные в canonical `.ts` файле. |
| `BrainVisualIntentKindDTO` | Семантический visual kind без asset key | Только kinds Animation Engine; manifest/clip names запрещены. |
| `BrainNeedsDTO.energy`, `attention`, `play`, `comfort`, `boredom` | Снимок шкал Character Engine | Каждое значение конечно и находится в `[0, 100]`. |
| `BrainActivityTimelineDTO.runId`, `activityId`, `phaseId`, `stage` | Идентичность run и текущей semantic-фазы | ID непустые; `stage` — `entering`, `looping` или `exiting`. |
| `BrainActivityTimelineDTO.startedAtMs`, `phaseStartedAtMs`, `phaseEndsAtMs` | Main-monotonic timeline Activity | Порядок времени задан в §6.2; `phaseEndsAtMs = null` только для causal phase. |
| `BrainMotionStateDTO.phase` | Authoritative physical phase | Только `dragged`, `airborne`, `grounded`. |
| `BrainMotionStateDTO.rootScreenPosition`, `velocityPxPerSec` | Authoritative root и velocity | Обе координаты конечны; Body их только отображает. |
| `BrainMotionStateDTO.positionAuthority` | Причина владения позицией | Только `forced` или `voluntary`; Skin не меняет authority. |

| `BrainStateDTO` поле | Назначение | Инвариант |
|---|---|---|
| `streamId` | Идентичность trusted subscription stream | Непустой ID до 128 символов; меняется при reload/replacement. |
| `revision` | Порядок полных snapshots | Положительный safe integer, строго возрастает внутри stream. |
| `sampledAtMs` | Main-monotonic момент снимка | Конечный, неотрицательный. |
| `character` | Needs и synthesized tone | Полная immutable Character projection. |
| `activity` | Текущая Activity timeline | `null` означает отсутствие active Activity. |
| `motion` | Authoritative motion projection | Полный `BrainMotionStateDTO`, не Renderer physics state. |
| `visualIntent` | Идентичность и семантика visual episode | Полный immutable `BrainVisualIntentDTO`; не содержит asset keys. |
| `globalCursor?` | Глобальное наблюдение для локального gaze | Absent/null — источник недоступен; finite DIP и Main timestamp ≤ `sampledAtMs`; возраст сохраняется Body, не продлевается RAF. |

| `BrainVisualIntentDTO` поле | Назначение | Инвариант |
|---|---|---|
| `episodeId`, `episodeSequence`, `episodeStartedAtMs` | Идентичность, порядок и старт visual episode | Sequence — positive safe integer, возрастает на каждый новый episode; ID уникален внутри stream; время — Main-monotonic. |
| `kind`, `category` | Семантика и класс визуального намерения | Значения ограничены literal unions из canonical `.ts` файла. |
| `priority`, `interrupt`, `loop` | Visual arbitration policy | Body разрешает policy в renderer-local projection; Skin только отображает результат и не возвращает outcome в Brain. |
| `emotionalTone` | Тон Character Engine | Принадлежит `BrainEmotionalToneDTO`. |
| `expressionHint?`, `gazeDirection?`, `propHint?` | Необязательные presentation hints | Отсутствие или literal variant; не являются manifest keys. |

| `BodyEventDTO` поле / variant | Назначение | Инвариант |
|---|---|---|
| `streamId`, `sequence`, `basedOnRevision`, `observedAtMs` | Общая metadata каждого события | Current stream; возрастающая sequence; принятая Brain revision; Renderer-monotonic observation time. |
| `cursor_observed.screenPosition` | Текущая глобальная позиция курсора | Конечные координаты; cadence ограничен §6.3. |
| `interaction.interaction`, `intensity?` | Семантический user input | Допустимы `click`, `double_click`, `right_click`, `pet`, `play`, `feed`, `think`; intensity при наличии конечна в `[0, 1]`. |
| `drag_started` / `drag_moved`: `gestureId`, `pointerId`, `screenPosition` | Начало и latest drag sample | Gesture регистрируется только после valid start; pointer ID неотрицательный safe integer. |
| `drag_ended`: те же поля + `cancelled` | Терминальное событие gesture | Ровно один terminal event для active пары gesture/pointer. |
| `menu_visibility_changed.expanded` | Наблюдение состояния меню | Boolean; не является visual completion или behavior decision. |

`phaseEndsAtMs: null` допускает только Brain-owned causal event/interruption, не Skin completion. `visualIntent.kind` — семантика [Animation](ANIMATION_ENGINE.md), не manifest/clip key.

Brain увеличивает `episodeSequence` и фиксирует `episodeStartedAtMs` на каждом намеренном старте/replay: Activity visual phase, повторной direct/click reaction, landing, forced transition — даже при прежних visual fields и `activity: null`. `episodeId = sequence + ':' + rawFactoryId.slice(0,100).trimEnd()` уникален по построению; Main хранит только счётчик, без списка прошлых IDs. Переполнение safe integer запрещает создание нового episode. Все поля одного `(streamId, episodeId, episodeSequence)` immutable; Motion/Needs-only revision сохраняет episode. Новая пара stream/episode ID перезапускает base Skin playback. Brain завершает episode публикацией следующего episode/state, без visual outcome.

Body создаёт один `gestureId` на gesture (trimmed non-empty, до 128 символов). Main активирует его после valid `drag_started`; ID служит корреляции ввода, не даёт position authority и не заменяет `sequence`.

### 6.1.1. Cursor-game-v1 presentation

Форма `CursorGamePresentationDTO` объявлена в shared. Обязательное поле `BrainStateDTO.cursorGame: CursorGamePresentationDTO | null` подключено в publisher, validators, preload, UI и fixtures. Отдельного канала/game command не требуется: cursor — существующий Body observation, игра выбирается локально. `null` — нет текущей игры/её terminal presentation; outcome=null пока исход не определён. Run ID и speech ID непустые до 128 символов, текст plain ≤240 code units, времена finite nonnegative, `expiresAtMs > startedAtMs`.

Application локализует semantic line key чистого Character selector по [Character §8.1](CHARACTER_ENGINE.md#81-game-a01-характер-локальной-игровой-речи), владеет сроком 2000 ms от создания реплики и публикует expiry/null через существующий scheduler. Каталог реплик расширяет игровую речь; базовый селектор outcome+locale сопоставляет реплики исходу игры. Outcome speech заменяет attempt speech. При terminal допускается держать outcome projection до expiry; новый run заменяет старую projection. Cancel/reset/reload/dispose/quiet очищают projection сразу. Late timer старого run/speech не очищает новую реплику. Renderer не запускает игру, не вычисляет caught и не возвращает speech completion в Brain.

При accepted user send скрыть game speech; пока dialogue thinking и 5000 ms после terminal dialogue commit новую игровую реплику не создавать (историю диалога не стирать). Срок считает Main по injected monotonic time; reset снимает этот speech guard. Затем новая game speech может заменить уже показанную dialogue bubble, не переигрывая старый ответ при expiry. Пропущенные фразы не ставятся в очередь. Reload/snapshot не продлевает expiry и не проигрывает speech повторно; dedupe по streamId + speech.id. Существующие visual intents/Skin остаются независимы от речи. Обязательны fixtures отсутствующей/невалидной projection, смены run, expiry, dialogue priority и once-only отображения.

**Каталог игровой речи ru/en.** В каждой ячейке RU / EN; стадии и физические исходы берутся только из Activity. `attempt` не обещает catch; `missed` признаёт промах, `lost_target` — потерю курсора без догадки о причине. Обращение к курсору не утверждает присутствие/участие человека. Нет насмешки над пользователем, упрёка, требования ответа или романтического содержания.

| Стадия | subdued | reserved | playful | neutral |
|---|---|---|---|---|
| attempt | Попробую потихоньку. / I'll try gently. | Я попробую поймать курсор… / I'll try to catch the cursor… | Курсор, держись! / Watch out, cursor! | Попробую поймать курсор. / I'll try to catch the cursor. |
| caught | Поймала. Можно выдохнуть. / Caught it. Time for a breather. | Кажется… поймала! / Oh… I caught it! | Ага, курсор пойман! / Aha, caught the cursor! | Поймала курсор! / Caught the cursor! |
| missed | Не поймала. Передохну. / Missed it. I'll take a breath. | Не получилось поймать… / I couldn't catch it… | Курсор ускользнул. Ловко! / The cursor slipped away. Clever! | Не поймала курсор. / I didn't catch the cursor. |
| lost_target | Потеряла курсор из виду. / I lost sight of the cursor. | Ой… где курсор? / Oh… where's the cursor? | Курсор исчез из виду. Вот загадка! / The cursor vanished from sight. A mystery! | Курсор больше не виден. / The cursor is no longer in sight. |

Только `caught` с `hadConfirmedCatchBeforeRun=true` заменяется историческим вариантом того же tone: subdued «Снова поймала. Можно выдохнуть.» / “Caught it again. Time for a breather.”; reserved «Снова получилось поймать…» / “I managed to catch it again…”; playful «Ещё одна поимка курсора!» / “Another cursor catch!”; neutral «Снова поймала курсор.» / “Caught the cursor again.” Итого 20 ключей на locale плюс silence для cancelled. Нет произвольных подстановок имён/счётчиков/текстов памяти. Missing key → neutral той же стадии без historical qualifier; unknown locale → ru; invalid/unknown stage → silence. Тексты plain1–240 UTF-16 units; каталог и fallback принадлежат Application.

Не более одной attempt- и одной outcome-реплики на run; первый зафиксированный outcome в reaction уже разрешает речь, terminal не дублирует её. Character/locale/evidence changes не переиздают speech; skipped из-за dialogue/quiet/cancel считается consumed, без catch-up. Сохранить вышеуказанные TTL/dedupe/generation guards, включая invalidation до публикации. Изменение tone/опыта никогда не меняет исход, физику, Activity длительность или animation intent. API v1 может добавить отдельный post-game комментарий по [AI Events §§3–4](../../../docs/contracts/AI_EVENTS_CONTRACT.md#3-causal-deadlines-quiet-и-игнорирование); локальный selector не ждёт SQLite/сеть/LLM и работает при eventsEnabled=false, offline или ошибке provider. Поздний AI reply не возобновляет игру и не меняет local projection.

**Таблица проверки игровой речи.** В первых четырёх строках actual outcome=missed, locale=ru; остальные входы одинаковы. Значения — `(energy, comfort, shyness, playfulness, boldness)`; authority уже разрешила игру, речь не решает admission.

| Вход/сценарий | Обязательный результат |
|---|---|
| (85,20,0.70,0.70,0.60) | reserved: «Не получилось поймать…»; outcome остаётся missed. |
| (85,20,0.30,0.70,0.60) | playful: «Курсор ускользнул. Ловко!»; тот же missed, никакого reward за речь. |
| (30,20,0.70,0.70,0.60) либо (85,70,0.30,0.70,0.60) | subdued раньше reserved/playful: «Не поймала. Передохну.»; никакого нового rest command. |
| (85,20,0.30,0.59,0.60); отдельно shyness=0.65 и playfulness=0.60/boldness=0.50 | Первый neutral; точные пороги дают reserved и playful соответственно. Non-finite/out-of-range → neutral без истории. |
| Тот же valid playful snapshot, current caught; прошлый confirmed caught до notice / лишь текущий ack после notice | Только первый: «Ещё одна поимка курсора!»; второй: «Ага, курсор пойман!» до следующего run. |
| Previous missed/lost_target/cancelled; failed/uncertain append; preference/summary/lore/AI line; empty/late read | Ни один не создаёт confirmed catch; neutral/playful base по snapshot, без выдуманной истории. Дубликат caught ack идемпотентен. |
| Последовательный run после ack; restart с caught в recent20 / без доступного reader | Первый и успешно hydrated дают historical caught; без reader — обычный caught сразу, игра не ждёт. |
| Все четыре стадии × четыре tone × ru/en; caught × четыре repeat tone; cancelled | Только конечные 40 locale/key пар; truthful исходы, bounds и fallback. Cancelled без новой реплики. |
| Accepted send, thinking, terminal dialogue+5000ms; quiet, cancel, reset, reload, dispose | Скрытие/пропуск без очереди; на точном expiry2000ms speech=null; stale run/timer/ack/read не меняет новый run/generation. Memory reset убирает historical qualifier и текущую speech. |
| Duplicate reaction/terminal/snapshot; новый run; events и observation API v1; backend offline/timeout | Once-only streamId+speech.id и max2/run; priority dialogue+guard → game → initiative → observation; local outcome сразу, поздняя сеть не возобновляет игру. |

Опциональное поле `BrainStateDTO.initiativeSpeech` передаёт ограниченную AI-фразу (absent/null — нет речи) независимо от исхода игры или очереди диалога. Время жизни, приоритет и поколение описаны в [AI Events §4](../../../docs/contracts/AI_EVENTS_CONTRACT.md#4-речь-связь-со-следующим-диалогом-и-память). Publisher, validator и Renderer обрабатывают поле согласованно; UI не инициирует event calls и не сообщает факт прочтения/проигрывания. Existing immediate game speech выше инициативы и не задерживается ради сети.

Опциональное поле `BrainStateDTO.observationSpeech` передаёт речь от наблюдения за активным приложением (absent/null — нет речи).
Types/publisher/validator/consumer подключены атомарно. Exact speech object:
`id` trimmed1–128, `text` plain1–240 UTF-16 units, finite nonnegative `startedAtMs`,
`expiresAtMs > startedAtMs`, lifetime≤2000ms; Main times, dedupe streamId+id.
Main expiry/invalidation публикует null; late timer не очищает новую speech. Reload не
переигрывает речь. Priority: dialogue+5s guard → game → initiative → observation;
потеря eligibility скрывает её, expiry не возвращает предыдущую bubble.
Consent/settings/preview — [Perception §11](PERCEPTION_ENGINE.md#11-obs-a02-активное-приложение-и-заголовок).
Settings reason `backend_unavailable` сообщает об отсутствии настроенного backend; helper при этом не запускается.
UI явно пишет про backend/внешнего provider и RAM-only настройки: после перезапуска
allowlist/согласие очищаются. Один opt-in на app name+title; no separate title toggle.
Typed commands: выбрать executable через Main picker, удалить/исключить appKey,
включить/выключить, pause/resume, удалить settings, открыть/закрыть preview. Main
проверяет trusted sender/exact fields/current policy; Renderer не задаёт path/title,
не вызывает HTTP и не решает eligibility. Settings/status — Main-authoritative snapshot;
preview только при explicit открытии, очищается при close/invalidation/reload.
Observation не создаёт dialogue turn/previousInitiative и не запускается из отображения.

### 6.2. Время, revision и order

- Main генерирует opaque `streamId` (до 128 символов) для trusted document; reload/replacement создаёт новый stream с revision `1`.
- `revision` строго возрастает на каждую полную snapshot: положительный safe integer, gaps допустимы; равная/меньшая stale.
- Все Main timestamps конечны, неотрицательны, на одной monotonic шкале: `sampledAtMs`, `startedAtMs`, `phaseStartedAtMs`, `phaseEndsAtMs`, `episodeStartedAtMs`. Требуется `startedAtMs <= phaseStartedAtMs <= sampledAtMs`, для bounded active phase `sampledAtMs < phaseEndsAtMs` (иначе сначала transition), для episode `episodeStartedAtMs <= sampledAtMs`.
- `observedAtMs` — Renderer-monotonic `performance.now()`, только для порядка/диагностики внутри Body stream. Main ставит собственный receive time до mapping, не вычитает часы Renderer.
- До первого принятого snapshot Body не emits. Event несёт active stream, последнюю принятую `basedOnRevision`, следующий положительный safe-integer `sequence`; gaps допустимы, повторы/уменьшение stale.

Body принимает первый полный snapshot текущей subscription, далее только matching stream с `revision > lastAcceptedRevision`, атомарно и без partial patches. `episodeSequence < current` отклоняется; равная sequence требует полностью прежнего immutable payload, большая — нового ID. Нарушение отклоняет **весь** snapshot, сохраняя valid state и bounded protocol diagnostic. Gate хранит только current sequence/ID/payload, O(1) по числу эпизодов, без исторической Map. Новый stream допустим лишь через новый subscribe lifecycle со сбросом revision/sequence/resources; первый sequence может быть больше 1 после Renderer reload.

`BodyVisualState.visualAgeMs = sampledAtMs - visualIntent.episodeStartedAtMs` — same-clock baseline нового episode. Далее Skin продвигает кадры по Renderer-monotonic delta; прежний episode не рестартует. Body/Skin не сравнивают Main time с `performance.now()`, не коррелируют по наличию Activity и не переключают semantic phase по `phaseEndsAtMs`.

### 6.3. Cadence и coalescing

- Brain публикует после committed semantic/Activity/Motion change, нового глобального cursor sample и сразу при subscribe. Unchanged heartbeat запрещён; повторный реальный cursor poll до 10 Hz меняет timestamp наблюдения. Semantic/Activity/position-authority transitions разных transactions не теряются.
- Одна Application transaction → одна snapshot; physics substeps одного внешнего Motion tick также дают максимум одну snapshot.
- При backpressure pending snapshots с изменением только motion/global cursor coalesce latest-wins; semantic/Activity/authority transitions сохраняют порядок. Revision gaps не скрывают semantic phase.
- `cursor_observed`: один Body refresh loop, независимо от RAF, `CURSOR_OBSERVATION_INTERVAL_MS = 100` (до 10 событий/с). Первый valid local sample после subscribe сразу; далее каждый 100-ms tick — latest position, даже неизменная, с новыми `observedAtMs`/`sequence`. Pointer moves заменяют pending position; delayed tick не делает catch-up burst.
- Остановить cursor refresh и очистить pending при `pointerleave`/`pointercancel`, hidden document/window teardown, drag, unsubscribe/unmount, stream replacement. Brain TTL делает sample stale без unavailable event. Это единственный допустимый unchanged Body refresh.
- `drag_moved` coalesce latest-wins максимум раз за Renderer frame. `drag_started`, `drag_ended`, `interaction`, `menu_visibility_changed` немедленны и не coalesce; sequence присваивается при фактической отправке.
- Skin RAF/clip completion/rejection/interruption локальны, не создают Body events и не задают Brain cadence.

### 6.4. Channels и Preload

```text
Main --wisp:brain-state(BrainStateDTO)--> onBrainState(listener) --> Body
Body --postBodyEvent(BodyEventDTO)--> wisp:body-event --> Main
```

Для этих потоков bridge предоставляет только `onBrainState(listener): () => void` и `postBodyEvent(event): Promise<void>`. Promise подтверждает validation/delivery, не semantic acceptance. Raw `ipcRenderer`, generic `send/on/invoke`, dynamic channels и Skin API через Preload запрещены.

### 6.5. Validation и stale-event policy

Обе стороны принимают `unknown`, валидируют plain non-null exact-shape object, копируют в новый DTO. Запрещены extra keys, prototype-bearing objects, methods/classes, cycles, `NaN`/`Infinity`, unknown enums; optional fields отсутствуют либо валидны. Needs/intensity: finite `[0, 100]`/`[0, 1]`; revision/sequence/`basedOnRevision`: positive safe integers; pointer ID: nonnegative safe integer; coordinates/velocity/timestamps: finite. Все ID, включая episode: trimmed non-empty до 128 символов.

Body проверяет immutable episode payload; Main — trusted current `webContents`. `think` — exact interaction literal, который Application маппит в candidate `BehaviorIntent<'think'>` через Character gating, не прямо в visual state.

Порядок Main validation:

1. Malformed/untrusted/foreign stream отклонить до Application.
2. `sequence <= lastAcceptedSequence` → idempotent no-op; gap допустим.
3. `basedOnRevision > currentRevision` → reject impossible future.
4. Старую revision перепроверить по **текущим** Character/Activity/Motion/menu/autonomy gates: accept/no-op/reject без восстановления старого state.
5. Drag сверить с active `gestureId`/`pointerId`; stimulus dedupe по `(streamId, sequence)`.

Валидный event остаётся input/observation. Brain принимает свои решения, не ждёт Body, не считает отсутствие event failure и не принимает visual outcome.

### 6.6. Отказ от animation-completion handshake

Обратный animation-completion handshake полностью упразднён; используется единый runtime протокол без compatibility bridge:

1. Shared exact validators/mappers + `wisp:brain-state`/`wisp:body-event` + точечные Preload methods; Main publisher и Renderer consumer используют единый Brain state.
2. `AnimationLifecycleOutcomeDTO`, `AnimationLifecycleResultDTO`, `PetPresentationStateDTO.animationRequestId`, `notifyAnimationLifecycleResult`, lifecycle channel/handler, pending request/context и `ANIMATION_LIFECYCLE_WATCHDOG_MS` удалены.
3. Без dual publish/subscribe, DTO adapter и Renderer-to-Main terminal outcomes. Первый snapshot после reload полностью восстанавливает Body/Skin.
4. Input producers переводятся на унифицированные Body events с отказом от устаревших каналов drag/interaction/menu.
5. Отдельные typed sleep/wake, autonomy setting, system/window commands сохраняются; generic IPC не расширять.

### 6.7. Зоны ответственности модулей runtime

| Подсистема | Зона ответственности |
|---|---|
| Body IPC & Channels | Exact DTO/validators/channels, отсутствие legacy handshake (§6.6). |
| Activity Runner | ActivityRunner/Needs/stimuli — цикл по монотонному времени, без Skin completion. |
| Body Controller | Body Controller и миграция ввода; DesktopPet — composition root. |
| Renderer Skin | Renderer-local ISkinEngine/SpriteSkinAdapter, revision-based render update. |
| Gaze & Cursor | Local gaze сразу; semantic eligibility — только Brain по cursor refresh до 10 Hz. |
| Route & Navigation | Explore route/phase/history — Brain; клип не задерживает routine. |
| Climb & Jump | Climb/jump — Brain Activity + Motion route; Body/Skin отображают. |
| Screen Geometry | Geometry — нормализация в Infrastructure/Main, без native handles/platform types в Body/Skin. |
| Route Arbitration | Explore/Rest arbitration/route/sleep kind — Brain; fallback не меняет outcome. |

## Quiet command и presentation

[SetQuietModeDTO, AutonomyModeDTO, QuietModeBridge, QuietModeBrainStateDTO](../../src/shared/ipc-contracts.ts): метод `setQuietMode` обязателен в `WispApiBridge`, а поле `autonomy.quiet` — в полном `BrainStateDTO`.

Один Main invoke `wisp:set-quiet-mode` через typed Preload: trusted sender, exact `{ enabled: boolean }` без coercion/extra keys, применение в Brain transaction. Response — authoritative mode; UI читает quiet из ordered snapshot, включая первый/reload. Отдельных mode-event очередей/renderer-owned state нет; повтор boolean идемпотентен, без новой opportunity; invalid payload не мутирует state.

Toggle в существующем меню не включает sleep и не меняет autonomy enabled. Семантика/cancel — [Character §2.2](CHARACTER_ENGINE.md#22-устойчивый-quiet-auto-a09). Renderer не считает budget/cooldown/admission. Disable/menu pause — отдельные blockers, закрытие меню не снимает quiet. `dialogue.turn` отображает provider thinking без заморозки locomotion/Activity; AI ownership/trace внутренние, Renderer не меняет Brain lifecycle.

## Локальный голосовой ввод

Контракты: [IVoiceInput](../../src/application/ports/voice-input.port.ts),
[VoiceInputApiBridge и DTO](../../src/shared/ipc-contracts.ts). Непрерывный голосовой режим
преобразует законченную фразу в обычный submit существующего Dialogue. Ответ остаётся
текстовым; TTS, wake word и облачная отправка аудио в этот scope не входят.

- Клавиатура и микрофон — два источника текста одного интерфейса Dialogue.
  Оба вызывают один обработчик [DialogueCommandClient.send](../../src/renderer/dialogue-command-client.ts):
  нормализация, валидация, admission, порядок команд и ошибки общие. После распознавания
  голос не выбирает отдельный provider и не создаёт упрощённый сетевой запрос.
  Main/Application собирают для обоих источников актуальное состояние персонажа,
  разрешённую локальную память и найденные эпизоды, историю диалога и остальные
  предусмотренные контрактом данные. Выборка памяти и её ограничения не зависят
  от способа ввода. Оба используют один выбранный AI provider и существующий `/v1/chat`;
  offline/mock — общий режим подключения, а не специальный fallback голосового ввода.
- Режим по умолчанию выключен. Пользователь явно включает его отдельной доступной
  кнопкой с видимым состоянием микрофона и немедленным выключением. После включения
  не требуются ручные start/stop/submit для каждой фразы. Закрытие текстового чата
  не выключает режим: контроллер ввода живёт независимо от ChatInput. Reload/reset,
  смена stream/conversation, lock/suspend/session deactivation, dispose и quit отзывают
  режим; unlock/resume не включают микрофон, повторное включение явное.
- Renderer владеет `getUserMedia({ audio: true })`, audio tracks, mono PCM/resampling
  и сегментацией пользовательского аудио. Простой energy VAD без новой зависимости
  удерживает до 300 ms pre-roll, принимает минимум 250 ms речи и завершает фразу после
  800 ms тишины либо при 15 s общего PCM. Буферы ограничены; тишина не порождает запросов.
  Это распознавание законченных фраз, без промежуточной потоковой транскрипции.
- Пока обычный Dialogue не принимает submit, новые аудиофразы не накапливаются и не
  отправляются. После восстановления готовности слушание продолжается без нового
  переключения. Одновременно допустима одна транскрипция; очереди старого аудио нет.
  Потеря микрофона или ошибка распознавания видна пользователю; бесконечного retry нет.
- Main хранит явное разрешение режима для текущих stream/conversation отдельно от
  краткоживущего requestId фразы. `enable` валидирует контекст и готовность локальной
  модели; `disable` идемпотентно отзывает режим и отменяет pending работу. Permission
  request/check handlers разрешают только microphone/audio для точных trusted
  webContents, main frame и app origin с активным режимом; camera и чужие frame/origin
  отклоняются. Electron isolation и CSP не ослабляются. Выключение останавливает tracks,
  сбрасывает VAD/PCM и запрещает поздний transcript/submit.
- Main сообщает отзыв режима событием `wisp:voice-disabled` с единственным payload
  `null`; Preload валидирует его и предоставляет typed `onDisabled` с unsubscribe.
  Renderer подписывается до запроса enable и при отзыве немедленно закрывает tracks,
  отменяет pending работу и очищает PCM/VAD. Отзыв действует и при закрытом ChatInput;
  повторные события идемпотентны. Power/session события инкапсулируются в Infrastructure
  platform adapter; Main получает только callback отзыва, Renderer не получает ОС API.
- `begin` проверяет активный режим и актуальный контекст, выдаёт один requestId фразы.
  Transcribe однократно потребляет его; повтор/foreign request не запускает inference.
  Main проверяет exact shape, dense finite mono PCM [-1,1] и существующий транспортный
  предел 1..480000 samples до Float32Array; Renderer ограничивает фразу 15 s при 16 kHz.
  Язык явный ru/en, задача transcribe, не translate. Deadline inference 60 s; generation
  проверяется после каждого await. Cancel/timeout прекращает вычисление в worker.
- Main создаёт Infrastructure adapter через Application port. CPU inference выполняется
  в Main-owned Node worker, вне Main event loop и Renderer. Допустим тёплый worker с
  одной моделью и последовательными запросами; после cancel/timeout worker завершается,
  следующий запрос создаёт новый. Worker получает только путь проверенной модели и PCM,
  без Electron API, credentials, dialogue/history и сетевых полномочий SDK.
- Распознанный текст отправляется через существующий валидированный Dialogue submit,
  сохраняя его admission, request IDs, cancellation, errors и лимит 240 символов.
  Тишина/пустой transcript не отправляются; превышение лимита не обрезается и показывается
  как ошибка с предложением более короткой фразы. Неподтверждённый текущим контекстом
  или поздний transcript после disable/reset/dispose не отправляется. Ручной текстовый
  ввод остаётся доступен; голос не затирает черновик и не создаёт второй Dialogue path.
- Pinned Whisper tiny multilingual q8 входит в поставку приложения отдельным ресурсом.
  Подготовка модели выполняется tooling до dev-запуска/упаковки, с manifest allowlist,
  размерами и SHA256 всех файлов; неполная подготовка блокирует готовность поставки.
  Runtime проверяет локальные ресурсы, не скачивает модель и не предлагает пользователю
  загрузку. Повреждение/отсутствие модели возвращает безопасную ошибку; текстовый чат
  и локальный runtime персонажа продолжают работу. SDK remote model access отключён.
- Аудио и transcript существуют только в памяти до окончания/отмены, не логируются
  и не сохраняются адаптером. Разрешённый состав передачи — только обычный текст
  после автоматического submit в явно включённом режиме; действуют существующие
  правила dialogue history/backend. Ошибки не раскрывают stack, пути, содержание речи
  или provider internals. Сетевые ошибки ответа не создают повторного voice submit.
