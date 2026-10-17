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

Application локализует semantic line key чистого Character selector по [Character §8.1](CHARACTER_ENGINE.md#81-game-a01-характер-локальной-игровой-речи), владеет сроком 2000 ms от создания реплики и публикует expiry/null через существующий scheduler. GAME-A01/#70 задаёт целевое расширение для GAME-I01; текущий selector outcome+locale ещё не реализует character/experience inputs. Outcome speech заменяет attempt speech. При terminal допускается держать outcome projection до expiry; новый run заменяет старую projection. Cancel/reset/reload/dispose/quiet очищают projection сразу. Late timer старого run/speech не очищает новую реплику. Renderer не запускает игру, не вычисляет caught и не возвращает speech completion в Brain.

При accepted user send скрыть game speech; пока dialogue thinking и 5000 ms после terminal dialogue commit новую игровую реплику не создавать (историю диалога не стирать). Срок считает Main по injected monotonic time; reset снимает этот speech guard. Затем новая game speech может заменить уже показанную dialogue bubble, не переигрывая старый ответ при expiry. Пропущенные фразы не ставятся в очередь. Reload/snapshot не продлевает expiry и не проигрывает speech повторно; dedupe по streamId + speech.id. Существующие visual intents/Skin остаются независимы от речи. Обязательны fixtures отсутствующей/невалидной projection, смены run, expiry, dialogue priority и once-only отображения.

**GAME-A01: конечный каталог ru/en.** В каждой ячейке RU / EN; стадии и физические исходы берутся только из Activity. `attempt` не обещает catch; `missed` признаёт промах, `lost_target` — потерю курсора без догадки о причине. Обращение к курсору не утверждает присутствие/участие человека. Нет насмешки над пользователем, упрёка, требования ответа или романтического содержания.

| Стадия | subdued | reserved | playful | neutral |
|---|---|---|---|---|
| attempt | Попробую потихоньку. / I'll try gently. | Я попробую поймать курсор… / I'll try to catch the cursor… | Курсор, держись! / Watch out, cursor! | Попробую поймать курсор. / I'll try to catch the cursor. |
| caught | Поймала. Можно выдохнуть. / Caught it. Time for a breather. | Кажется… поймала! / Oh… I caught it! | Ага, курсор пойман! / Aha, caught the cursor! | Поймала курсор! / Caught the cursor! |
| missed | Не поймала. Передохну. / Missed it. I'll take a breath. | Не получилось поймать… / I couldn't catch it… | Курсор ускользнул. Ловко! / The cursor slipped away. Clever! | Не поймала курсор. / I didn't catch the cursor. |
| lost_target | Потеряла курсор из виду. / I lost sight of the cursor. | Ой… где курсор? / Oh… where's the cursor? | Курсор исчез из виду. Вот загадка! / The cursor vanished from sight. A mystery! | Курсор больше не виден. / The cursor is no longer in sight. |

Только `caught` с `hadConfirmedCatchBeforeRun=true` заменяется историческим вариантом того же tone: subdued «Снова поймала. Можно выдохнуть.» / “Caught it again. Time for a breather.”; reserved «Снова получилось поймать…» / “I managed to catch it again…”; playful «Ещё одна поимка курсора!» / “Another cursor catch!”; neutral «Снова поймала курсор.» / “Caught the cursor again.” Итого 20 ключей на locale плюс silence для cancelled. Нет произвольных подстановок имён/счётчиков/текстов памяти. Missing key → neutral той же стадии без historical qualifier; unknown locale → ru; invalid/unknown stage → silence. Тексты plain1–240 UTF-16 units; каталог и fallback принадлежат Application.

Не более одной attempt- и одной outcome-реплики на run; первый зафиксированный outcome в reaction уже разрешает речь, terminal не дублирует её. Character/locale/evidence changes не переиздают speech; skipped из-за dialogue/quiet/cancel считается consumed, без catch-up. Сохранить вышеуказанные TTL/dedupe/generation guards, включая invalidation до публикации. Изменение tone/опыта никогда не меняет исход, физику, Activity длительность или animation intent. API v3 может добавить отдельный post-game комментарий по [AI Events §§3–4](../../../docs/contracts/AI_EVENTS_CONTRACT.md#3-causal-deadlines-quiet-и-игнорирование); локальный selector не ждёт SQLite/сеть/LLM и работает при eventsEnabled=false, offline или ошибке provider. Поздний AI reply не возобновляет игру и не меняет local projection.

**Конечная приёмка GAME-I01.** В первых четырёх строках actual outcome=missed, locale=ru; остальные входы одинаковы. Значения — `(energy, comfort, shyness, playfulness, boldness)`; authority уже разрешила игру, речь не решает admission.

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
| Duplicate reaction/terminal/snapshot; новый run; события v3 и observation v6; backend offline/timeout | Once-only streamId+speech.id и max2/run; priority dialogue+guard → game → initiative → observation; local outcome сразу, поздняя сеть не возобновляет игру. |

P17-A04 добавляет optional `BrainStateDTO.initiativeSpeech` для bounded AI-фразы (absent/null — нет речи), независимо от game outcome/Dialogue turn. Lifetime/priority/current generation — [AI Events §4](../../../docs/contracts/AI_EVENTS_CONTRACT.md#4-речь-связь-со-следующим-диалогом-и-память). Publisher/validator/Renderer подключаются в #59 атомарно; UI не инициирует event calls и не сообщает факт прочтения/проигрывания. Existing immediate game speech выше инициативы и не задерживается ради сети.

OBS-A02/#81 реализует optional `BrainStateDTO.observationSpeech`; absent/null — нет речи.
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

### 6.6. Атомарная миграция с legacy protocol

[AUTO-A06 #31](https://github.com/zyzycode/project_wisp/issues/31) superseded для animation-completion handshake. AUTO-I07 — единый runtime cutover, без compatibility bridge/feature flag:

1. Shared exact validators/mappers + `wisp:brain-state`/`wisp:body-event` + точечные Preload methods; в том же change-set Main publisher/Renderer consumer переходят с `PetPresentationStateDTO` на полный Brain state.
2. Удалить `AnimationLifecycleOutcomeDTO`, `AnimationLifecycleResultDTO`, `PetPresentationStateDTO.animationRequestId`, `notifyAnimationLifecycleResult`, lifecycle channel/handler, pending request/context и `ANIMATION_LIFECYCLE_WATCHDOG_MS`.
3. Без dual publish/subscribe, DTO adapter и Renderer-to-Main terminal outcomes. Первый snapshot после reload полностью восстанавливает Body/Skin.
4. AUTO-I09 одновременно переводит input producers на Body events и удаляет specialized drag/interaction/menu channels; до этого они только transitional input, не presentation/lifecycle protocol.
5. Отдельные typed sleep/wake, autonomy setting, system/window commands сохраняются; generic IPC не расширять.

Соседство target/legacy типов в shared до implementation merge не означает dual runtime protocol: переключение publishers/channels/consumers атомарно.

### 6.7. Последствия для Phase 14 slices

| Задача | Обязательное последствие |
|---|---|
| [AUTO-I07 #39](https://github.com/zyzycode/project_wisp/issues/39) | Exact DTO/validators/channels, удаление legacy handshake (§6.6). |
| [AUTO-I08 #41](https://github.com/zyzycode/project_wisp/issues/41) | ActivityRunner/Needs/stimuli — Main-monotonic loop, без Skin completion. |
| [AUTO-I09 #40](https://github.com/zyzycode/project_wisp/issues/40) | Body Controller/input migration; DesktopPet — composition root. |
| [AUTO-I10 #42](https://github.com/zyzycode/project_wisp/issues/42) | Renderer-local ISkinEngine/SpriteSkinAdapter, revision-based render update. |
| [AUTO-I02 #33](https://github.com/zyzycode/project_wisp/issues/33) | Local gaze сразу; semantic eligibility — только Brain по cursor refresh до 10 Hz. |
| [AUTO-I03 #34](https://github.com/zyzycode/project_wisp/issues/34) | Explore route/phase/history — Brain; клип не задерживает routine. |
| [AUTO-I04 #35](https://github.com/zyzycode/project_wisp/issues/35) | Climb/jump — Brain Activity + Motion route; Body/Skin отображают. |
| [AUTO-I05 #36](https://github.com/zyzycode/project_wisp/issues/36) | Geometry — Infrastructure/Main normalization, без native handles/platform types в Body/Skin. |
| [AUTO-I06 #37](https://github.com/zyzycode/project_wisp/issues/37) | Explore/Rest arbitration/route/sleep kind — Brain; fallback не меняет outcome. |

## AUTO-A09: quiet command и presentation

[SetQuietModeDTO, AutonomyModeDTO, QuietModeBridge, QuietModeBrainStateDTO](../../src/shared/ipc-contracts.ts) — target #49. При реализации `setQuietMode` становится обязательным в `WispApiBridge`, `autonomy.quiet` — в полном `BrainStateDTO`; временные interfaces сворачиваются в том же change-set. До #49 declarations не означают runtime capability.

Один Main invoke `wisp:set-quiet-mode` через typed Preload: trusted sender, exact `{ enabled: boolean }` без coercion/extra keys, применение в Brain transaction. Response — authoritative mode; UI читает quiet из ordered snapshot, включая первый/reload. Отдельных mode-event очередей/renderer-owned state нет; повтор boolean идемпотентен, без новой opportunity; invalid payload не мутирует state.

Toggle в существующем меню не включает sleep и не меняет autonomy enabled. Семантика/cancel — [Character §2.2](CHARACTER_ENGINE.md#22-устойчивый-quiet-auto-a09). Renderer не считает budget/cooldown/admission. Disable/menu pause — отдельные blockers, закрытие меню не снимает quiet. `dialogue.turn` отображает provider thinking без заморозки locomotion/Activity; AI ownership/trace внутренние, Renderer не меняет Brain lifecycle.
