# Контракт Render Engine

Канонические manifest/frame timing/composition/fallback правила. Изменение семантики требует Architect review.

## Владение и границы ответственности

`BrainStateDTO → PetBodyController → BodyVisualState → ISkinEngine → SpriteSkinAdapter → Asset/Fallback Resolver → Animation Player → ICharacterRenderer`.

Brain владеет semantic `AnimationIntent`, Activity phase/Needs/authoritative motion, публикует DTO без asset keys. Body добавляет renderer-local input/reflex projection (gaze/drag squash-stretch на RAF без per-frame IPC). Skin выбирает assets/fallback, считает frames по Renderer-monotonic delta.

Renderer не парсит provider DTO, не считает Needs/Activity/authoritative position, не импортирует Electron/Node/platform APIs. DOM/canvas/resources остаются локальны; Main/Application/Domain/Shared получают plain serializable DTO.

### Общая геометрия окна и визуального root

[PetPresentationLayoutDTO](../../src/shared/ipc-contracts.ts) — статическая конфигурация; один экземпляр и pure projection в [pet-presentation-layout.ts](../../src/shared/pet-presentation-layout.ts) принадлежат Render и напрямую потребляются Main/Renderer. Shared-модуль без Renderer/DOM/React/Electron/Domain imports; новый IPC/runtime layout service/DOM measurement для Main не нужны.

- Compact 280×542, expanded 1140×620; character rect (20, 240, 240, 240), viewport 512×512, root (256, 460). Верхняя область отведена под ответ и неподвижный ввод с зазором 2 DIP между ними; длинный текст прокручивается, оба блока остаются выше character rect. CSS/CharacterRenderer/default viewport-pivot/Main используют общий экземпляр, без копий чисел.
- `calculateWindowRootPivotOffset(layout)`: `s = min(width / viewport.width, height / viewport.height)`; `letterbox = (characterSize - viewportSize * s) / 2`; `offset = characterRect.origin + letterbox + spriteRootPivot * s`. Сейчас offset=(140, 455.625) DIP, SVG `xMidYMid meet`.
- Position adapter получает готовый `pivotOffset`: root↔native, rounding/clamp/commit; scale/letterbox не считает. Main компонует размеры/DI без собственных CSS/Render constants. Меню сохраняет origin/root offset; DPR к DIP не применяется, physical-pixel conversion — platform adapters.
- Screen bounds ограничивают contact root; прозрачный native origin может выходить за экран. `IPlatformAdapter.getOverlayWindowOptions()` задаёт constructor policy: macOS включает `enableLargerThanScreen` для frameless окна, чтобы Cocoa не сдвигал root; Windows/Linux сохраняют defaults. Main применяет эти options до фиксированных security settings.
- Skin совмещает frame pivot с canonical root. Flip/squash/смена клипа не меняют native offset/position authority. Исходный `canvasSize` передаётся отдельно от fixed viewport; нестандартный frame не меняет масштаб всего canvas.

Проверки: `frontend/tests/shared/pet-presentation-layout.test.ts` — asymmetric letterbox, compact/expanded parity; Renderer — canonical root при frame change и нестандартные canvas/pivots.

### Renderer-local Skin contract

[skin-engine.ts](../../src/renderer/render-engine/skin-engine.ts): `ISkinEngine`, `BodyVisualState`, reflex types — только Renderer, не Application port/shared IPC.

| `BodyVisualState` поле | Назначение | Инвариант |
|---|---|---|
| `streamId` | Связывает projection с текущим Brain stream | Непустой trusted ID; при replacement создаётся новый Skin lifecycle. |
| `revision` | Порядок полных visual projections, включая локальные reflex updates | Положительный safe integer; update с уже применённой revision не публикуется повторно. |
| `visualIntent` | Immutable semantic intent текущего Brain episode | Для пары `(streamId, episodeId)` payload неизменен; asset keys отсутствуют. |
| `visualAgeMs` | Same-clock baseline возраста visual episode, вычисленный Body | Равен `sampledAtMs - episodeStartedAtMs`, конечен и неотрицателен; Skin не сравнивает Main и Renderer clocks. |
| `cursorGameReaction?` | Контекст выбора игрового клипа: `caught`, `missed`, `lost_target` | Только для `cursor_interest/reaction` при совпадении run ID с готовым Brain outcome. Skin выбирает `body_cursor_caught`/`body_cursor_missed`; отсутствие ассета сохраняет общий reaction fallback. Исход и границы фазы остаются в Brain. |
| `reflex.pupilOffset` | Renderer-local смещение взгляда | Обе компоненты конечны и нормализованы в `[-1, 1]`; не пересекают IPC. |
| `reflex.transform` | `flipX`, `scaleX`, `scaleY`, `rotationDeg` для gaze/drag squash/stretch | Числа конечны, масштабы положительны; transform не меняет motion authority. |

| Операция `ISkinEngine` | Назначение | Инвариант lifecycle |
|---|---|---|
| `init()` | Создать renderer-local resources | Идемпотентна в рамках одного instance lifecycle. |
| `update(state)` | Применить последнюю полную `BodyVisualState` | Не принимает partial patch; повтор revision не создаёт React/render update. |
| `destroy()` | Остановить RAF/player callbacks и освободить resources | После возврата новые updates запрещены. |

`SpriteSkinAdapter` — единственный реализованный Skin adapter, оборачивает текущие resolver/player/renderer/manifest без format migration. Base clip стартует/replay только при новой паре `(streamId, visualIntent.episodeId)` с baseline `visualAgeMs`; Brain revision/reflex старого episode не сбрасывают playback. Completion локален, не входит в `BodyEventDTO` и не создаёт Brain outcome.

Нейтральный gaze может использовать зарегистрированную пару `face_gaze_base` +
`pupils_gaze` только при явном `enableContinuousGaze` и overlay-совместимости с
`face_gaze`. По умолчанию флаг выключен: runtime использует прежнее лицо и
дискретные кадры `face_gaze`, независимо от наличия новой пары в manifest. Player привязывает
оба слоя к одному текущему body anchor; отдельный pupil handle получает дробный
Body offset и меняет только SVG translate (±2/±1 source px), без per-frame React
publication. Семантическая эмоция имеет приоритет. Неполная пара или ошибка
загрузки любого её PNG атомарно возвращает прежний face fallback; пустая основа
без радужек и радужки без основы отдельно не отображаются.

`sprite-projection.ts` задаёт общий порядок pivot → rotation → scale/reflection
для SVG, anchor marker и inverse gaze projection с letterboxing. Нативное
направление body art нормализуется Skin до вычисления gaze geometry. Геометрия
использует фактический frame pivot/anchor, не только размеры контейнера.

Spine/Live2D, placeholders, внешние зависимости и адаптеры требуют отдельных согласований зависимостей и готовых rig assets.

## 1. Manifest & Asset Metadata

Реестр: `frontend/public/assets/sprites/manifest.json`.

### 1.1. Идентификаторы и категории

Стабильный snake_case animation key: `<layer>_<name>[_<variant>]`.

| Layer category | Назначение | Примеры keys | Manifest category |
|---|---|---|---|
| `body` | Базовый силуэт и поза персонажа | `body_idle`, `body_walk`, `body_sleep`, `body_dragged`, `body_land` | `body/<name>` |
| `face` | Полная дорожка лица или мимики | `face_idle`, `face_happy`, `face_sleepy` | `face/<name>` (legacy: `faces/<name>`) |
| `expression` / `emotion` | Частичная мимика и эмоции поверх лица | `expression_blush`, `expression_wink`, `expression_pout` | `expression/<name>` |
| `props` / `prop` | Реквизит и визуальные эффекты | `prop_pillow`, `prop_heart`, `prop_question`, `prop_sparkle` | `props/<name>` (нормализация `fx/*` в `props`) |

`body_*` только для тела; face/expression не заменяют его fallback. Prop — реквизит/эффекты. Legacy `faces/<name>` нормализуется в `face/<name>`.

### 1.2. Спецификация манифеста и типы

[types.ts](../../src/renderer/render-engine/types.ts): слои body/face/emotion/prop; animation fields `frames`, `fps`, `loop`, `pivot`, `faceOverlay`, `frameMeta`. `emotionalTone` использует [Character SynthesizedEmotionalTone](CHARACTER_ENGINE.md#8-эмоциональный-тон-синтез-настроения).

Validation: непустые frames, optional `framesCount = frames.length`; fps/durationMs >0; sourceRect/canvasSize width/height >0; pivot.x/y в source-canvas pixels. Пути относительные либо `/assets/...`, traversal `..` запрещён. Flat manifest допускает отсутствие schemaVersion и нормализуется в `animations`; body требует faceOverlay.

### 1.3. Frame Timing

Monotonic `performance.now()`:

```text
frameDurationMs = 1000 / fps
```

Приоритет: `frame.durationMs -> 1000 / animation.fps -> 1000 / DEFAULT_SPRITE_FPS`; `DEFAULT_SPRITE_FPS = 5` body, `DEFAULT_FACE_FPS = 3` face. Большой deltaMs сразу математически выбирает frame/completion, без покадрового цикла.

### 1.4. Sprite Slicing

Frames — PNG paths либо atlas `SpriteFrameDef.sourceRect`, отсчитываемый от верхнего левого source. Pivot: `frame.pivot -> animation.pivot -> layer default`. Body default contact: `{ x: 256, y: 460 }`; non-body pivots явные, `DEFAULT_FACE_PIVOT = { x: 256, y: 180 }`.

### 1.5. Body-to-Face Compatibility (`faceOverlay`)

Каждый body объявляет faceOverlay; для face/expression/prop это поле запрещено.

| Режим | Описание | Обязательные поля | Поведение рендера |
|---|---|---|---|
| `overlay` | На спрайте тела отсутствует лицо; накладывается динамический оверлей. | Непустой `allowedFaceKeys`, `anchor: "face"`, `fallback`. | Выбирается запрошенный `face_*`; при его отсутствии используется `fallback` (или скрытие, если `none`). |
| `baked_in` | Лицо врисовано непосредственно в спрайт тела (движение/реакции). | `fallback: "none"`; запрещены `allowedFaceKeys` и `anchor`. | Оверлей полного лица никогда не рисуется. |
| `none` | Поза несовместима с оверлеем лица и не имеет врисованного лица. | `fallback: "none"`; запрещены `allowedFaceKeys` и `anchor`. | Слой лица полностью скрывается. |

Для overlay: только face/* keys; объявленный `anchor` в `defaultAnchors`/`frameMeta`; fallback входит в allowedFaceKeys либо `none`. Baked-in/none никогда не получают allowedFaceKeys/anchor, fallback только none. Без якоря overlay запрещён; expression не заменяет полный face track.

Текущие назначения/allowedFaceKeys определяет [manifest.json](../../public/assets/sprites/manifest.json), включая каждый вариант позы. Каталог capabilities и face keys читается из манифеста, не выводится из имени клипа и не копируется сюда. Наличие face asset не разрешает overlay на `baked_in`/`none`.

### 1.6. Система координат (Face Anchor & Pivot)

Source-canvas pixels: origin (0,0) сверху слева нерастянутого frame, X вправо/Y вниз; не CSS pixels/проценты.

- Anchor тела `frameMeta[i].anchors[name] ?? defaultAnchors[name]` совмещается с `faceFrame.pivot ?? faceAnimation.pivot`; отсутствующий anchor запрещает overlay.
- Body contact: `frame.pivot ?? animation.pivot ?? DEFAULT_SPRITE_PIVOT`.
- Body/face независимы по timing/length, композиция использует текущий frame каждого track.

### 1.7. Стандарт количества кадров (Frame Count Contract)

Для body/face/pupils/effects минимум **4 frames**; 2–3 запрещены из-за стробирования. 4 frames: 1 row ×4 columns, `_00.png`..`_03.png`; 8 frames (например body_idle): 2 rows ×4 columns, `_00.png`..`_07.png`. Более длинные последовательности ≥4 допустимы для плавного действия/перехода.

## 2. Layer Ordering & Blend

| Слой | Z-Index | Opacity | Blend Mode | Назначение |
|---|---|---|---|---|
| `body` | 10 | 1.0 | `normal` | Базовый силуэт и поза тела (`base_body`) |
| `face` | 20 | 1.0 | `normal` | Дорожка лица / оверлей (`face`) |
| `emotion` | 30 | 0.9 | `normal` | Мимика, эмоции и процедурный румянец (`expression`, `procedural_blush`) |
| `prop` | 40 | 1.0 | `normal` / `additive` / `screen` | Реквизит и спецэффекты (`prop_*`) |

Procedural blush — SVG radial-gradient tint поверх щёк без вытеснения sprite layers. Props привязаны к root pivot; `blendMode: 'additive'`/`blendMode: 'screen'` не clip-ятся базовым телом.

## 3. Fallback Resolver & Детерминизм

### 3-уровневый Fallback Resolver

1. Exact `(kind, emotionalTone, hints)` → специализированный sprite/overlay.
2. Нет `body_<kind>_<tone>` → `body_<kind> -> body_idle` + доступный независимый emotion/prop overlay.
3. Нет safe category/layer art → `body_idle + face_idle`; отсутствующий face_idle скрыть, отсутствующий body_idle → procedural placeholder + warning.

### Ключевые инварианты

Fallback не бросает unhandled exceptions, optional layers деградируют до base body; меняется только presentation, не исходные `AnimationIntent`/`BehaviorIntent`. Экспрессивность не повышать: shy→idle, не affectionate.

`fps > 0`; assets загружены **до** синхронного render tick, без async loading посреди него. Одинаковый `RenderPresentationState` даёт идентичный frame независимо от tick frequency. Render не меняет semantic FSM; UI/DOM/resources локальны, platform APIs запрещены.

## 4. Условный контракт управляемого тела

Требования ниже — целевой контракт повторного rig gate [BODY-A01 / #180](https://github.com/zyzycode/project_wisp/issues/180), **не реализованные возможности**. Подключение rig сейчас не разрешено: остаётся `SpriteSkinAdapter`. Исследованный runtime-кандидат, Dependency Review и причины no-go фиксируются в Issue; кандидат не означает разрешения устанавливать пакет. Для нового go нужны готовый human-authored pack, подтверждённые права поставки и измерения. Графика, экспорт и rigging агентами не выполняются.

### 4.1. Входы и проверяемые capabilities

Будущий adapter потребляет тот же ordered `BodyVisualState`; bones, tracks, attachments, resource handles и mouth playback остаются renderer-local. Новые Application/IPC/Domain rig API не нужны. Существующий semantic expression #161 не проектируется заново.

| Канал | Разрешённый вход | Реальные sprites / требование к будущему rig | Unsupported fallback |
|---|---|---|---|
| Base motion | `visualIntent.kind/loop`, episode age и authoritative velocity | Sprites — готовые clips; rig — authored idle/walk/sit/drag/fall/sleep | Существующий category/base fallback §3 |
| Additive pose | Только явно разрешённая semantic projection | В текущем Body нет независимой fatigue intensity; rig требует отдельной маски и authored pose | Опустить pose; не рассчитывать Need/эмоцию в Renderer |
| Face | `expressionHint`, `emotionalTone` | Sprites — строго `faceOverlay`; rig — независимые face controls с таблицей semantic соответствий | Совместимое нейтральное лицо; без усиления/противоположной эмоции |
| Gaze | Нормализованный `reflex.pupilOffset` | Sprites — дискретный либо явно включённый continuous gaze; rig — отдельные eye targets/limits | Нейтральный взгляд; не подменять semantic expression |
| Hands/props | Только существующий/отдельно согласованный semantic hint | Sprites — доступные prop layers; rig — authored grips, anchors, attachments и pose compatibility | Удалить несовместимый/отсутствующий prop |
| Mouth playback | Фактический renderer audio handle/clock и bounded envelope | Сейчас отдельного mouth channel нет; rig требует независимой resting/open формы | Неподвижная совместимая resting pose |

`sleepy` hint можно отображать без нового semantic входа. Непрерывная усталость/интенсивность не считается уже доступной: расширение разрешённой Main projection согласуется отдельно до #182. Подготовка текста/TTS или UI `speaking` не запускают mouth. Первый mouth slice — activity/envelope, без обещания фонемной точности.

### 4.2. Композиция, приоритеты и contact root

Один base track следует текущему Brain episode; additive updates не сбрасывают его clock. Остальные каналы применяются только при capability и совместимости текущей позы. Приоритеты forced/sleep и Brain timeline остаются в [Animation §2/§5](ANIMATION_ENGINE.md#2-матрица-приоритетов-и-прерываний).

- Drag/fall/landing и защищённый sleep атомарно снимают несовместимые pose/hands/props/gaze. Они не ждут завершения rig clip. Новый semantic face сильнее локального gaze; mouth меняет только разрешённые mouth controls, сохраняя emotion.
- Artist pack перечисляет непересекающиеся bone/property masks и совместимые сочетания для base, pose, face, gaze, hands/mouth; совпадающие masks без явного порядка отклоняются. Missing optional layer не меняет исходный hint.
- Gaze ограничен `[-1,1]`, mapped к authored limits; smoothing использует только Renderer delta, время стабилизации — целевые 100 ms. При утрате актуального cursor observation target нейтрален. Reset/stream replacement очищают старые targets/attachments сразу.
- Contact root привязан к canonical root из раздела общей геометрии; root translation из rig clip запрещена. Визуальный offset анимации — дочерний относительно contact root. Reflection/scale/rotation и переход поз не меняют native offset или authoritative velocity.
- Feet/hand/face anchors используют ту же projection и letterboxing; bounds не вычисляют новую физику, опору или hit outcome. Secondary rig physics первого slice выключена.

### 4.3. Pack и validation

Готовый pack размещается только в разрешённом каталоге assets; миграция sprite manifest и новый resource format требуют конкретного повторного go. До этого существующие PNG/manifest не преобразуются.

Художник-человек предоставляет exported skeleton, atlas и все referenced textures; authoring source, точную editor/export версию, native facing/scale, canonical contact root, bounds и реестр clips/capabilities. Обязательны проверяемые face/eyes/hands/feet anchors; additive poses/grips/mouth — только для заявленных capabilities. Для каждого semantic hint указаны compatible poses и safe fallback. Коммерческие права на artwork/rig, изменение и распространение подтверждаются отдельно от runtime license.

Перед активацией проверяются local-only paths без traversal/URL, размер данных и decoded texture dimensions, finite transforms, наличие root/anchors/base clips, atlas references, masks, limits и точная совместимость export/runtime major.minor. Повреждённая обязательная база отклоняет весь pack; отсутствующая optional capability деградирует отдельно. Никаких resource loads в синхронном render tick.

### 4.4. Загрузка, replacement и освобождение

Sprite fallback остаётся видимым до полной загрузки/validation rig; переключение атомарно применяет последний snapshot и episode age. Один Skin instance владеет своими RAF/resources/listeners; одновременно визуализируется один adapter.

| Граница/ошибка | Требуемое поведение |
|---|---|
| Missing/corrupt resource, incompatible export, load deadline | Освободить частично загруженное; применить sprite fallback актуального snapshot и bounded diagnostic без содержимого ресурсов |
| WebGL/context недоступен или потерян | Остановить rig и перейти к sprites; автоматический бесконечный reload запрещён |
| Старая revision/stream/generation или late load | Не публиковать; late result освобождает только собственные resources |
| Reset/replacement | Инвалидировать load generation, очистить controls/attachments и создать новый lifecycle; не оживлять старый episode |
| `destroy()`/unmount | Идемпотентно отменить RAF/loading, снять callbacks/listeners/subscriptions, освободить textures/buffers/shaders и ссылки; после возврата публикации запрещены |

Retry допускается только новым явно созданным lifecycle; Brain продолжает semantic progression при любом исходе. Rig completion/listener не пересекает BodyEvent/Preload/Main boundary.

### 4.5. Целевые пределы и performance/visual gate

Числа ниже — **TARGETS для будущей реализации, не измерения и не доказательство готовности**. Превышение требует облегчить human pack либо повторно согласовать бюджет; нельзя молча объявить passed.

| Параметр одного rig | Целевой предел |
|---|---|
| Resources | Один context; ≤2 atlas pages по 2048×2048 RGBA, ≤32 MiB raw texels без browser/driver copies; pack ≤8 MiB, skeleton JSON ≤2 MiB |
| Complexity | ≤100 bones, 150 slots, 10 000 visible vertices, 3 influences/vertex, 5 tracks; без clipping в первом slice |
| Load | Ready ≤2 s на локальном диске, затем sprite fallback |
| CPU/frame при 240 DIP, DPR 1/2, 60 Hz | Adapter update+draw p95 ≤2 ms, p99 ≤4 ms; ≤20 draw calls/frame; frame interval p95 ≤20 ms |
| Publication | Неизменное изображение — ноль дополнительных React publications; gaze/mouth не создают per-frame IPC |
| Memory/lifecycle | Renderer RSS delta к прогретым sprites ≤64 MiB; retained delta ≤5 MiB после 100 replacement/dispose cycles и GC settling |
| Mouth | Начало/конец envelope ≤50 ms от фактического audio clock; stop закрывает mouth не позднее следующего RAF |

Проверка использует один scripted Brain trace для sprites/rig и фиксирует semantic parity, отсутствие root/native-window drift и сохранение episode cadence. Матрица: idle/walk/sit × neutral/annoyed/tired × доступный gaze; drag/fall/sleep, props/mouth, invalid resources, context loss, reset/replacement/dispose. Unsupported art помечается unsupported, не successful visual combination. Отдельно проверяются flip/scale/rotation, compact/expanded и DPR 1/2.

Для Windows, macOS и Linux Wayland/X11 записываются OS/hardware/driver/DPR, длительность прогона, CPU/RSS/frame percentiles, GPU timing при наличии и PASS/NOT RUN каждого сценария. GPU percentage, native transparency и качество изображения не выводятся из unit mocks или факта WebGL support. Human visual/voice acceptance остаётся отдельной проверкой.

Технические основания будущего gate: [официальный spine-ts README](https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/spine-ts/README.md) описывает JS/TS backends и ограничения Canvas; [AnimationState](https://esotericsoftware.com/spine-applying-animations) — layering; [versioning](https://esotericsoftware.com/spine-versioning) — matching major.minor; [clipping](https://eu.esotericsoftware.com/spine-clipping) — стоимость CPU. Право интеграции/поставки проверяется по [Editor License §2](https://esotericsoftware.com/spine-editor-license) и [Runtime License](https://esotericsoftware.com/spine-runtimes-license); наличие editor license художника не подтверждает автоматически права разработчика. Maintenance оценивается по [датированным официальным spine-ts releases](https://github.com/EsotericSoftware/spine-runtimes/actions/workflows/spine-ts.yml) при повторном Dependency Review, без security audit/обновления текущих зависимостей.
