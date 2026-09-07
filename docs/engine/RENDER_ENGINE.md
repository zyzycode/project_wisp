# Контракт Render Engine

Канонические manifest/frame timing/composition/fallback правила. Изменение семантики требует Architect review.

## Владение и границы ответственности

`BrainStateDTO → PetBodyController → BodyVisualState → ISkinEngine → SpriteSkinAdapter → Asset/Fallback Resolver → Animation Player → ICharacterRenderer`.

Brain владеет semantic `AnimationIntent`, Activity phase/Needs/authoritative motion, публикует DTO без asset keys. Body добавляет renderer-local input/reflex projection (gaze/drag squash-stretch на RAF без per-frame IPC). Skin выбирает assets/fallback, считает frames по Renderer-monotonic delta.

Renderer не парсит provider DTO, не считает Needs/Activity/authoritative position, не импортирует Electron/Node/platform APIs. DOM/canvas/resources остаются локальны; Main/Application/Domain/Shared получают plain serializable DTO.

### #43: общая геометрия окна и визуального root

[PetPresentationLayoutDTO](../../src/shared/ipc-contracts.ts) — статическая конфигурация; один экземпляр и pure projection в [pet-presentation-layout.ts](../../src/shared/pet-presentation-layout.ts) принадлежат Render и напрямую потребляются Main/Renderer. Shared-модуль без Renderer/DOM/React/Electron/Domain imports; новый IPC/runtime layout service/DOM measurement для Main не нужны.

- Compact 280×320, expanded 1140×620; character rect (20, 18, 240, 240), viewport 512×512, root (256, 460). CSS/CharacterRenderer/default viewport-pivot/Main используют общий экземпляр, без копий чисел.
- `calculateWindowRootPivotOffset(layout)`: `s = min(width / viewport.width, height / viewport.height)`; `letterbox = (characterSize - viewportSize * s) / 2`; `offset = characterRect.origin + letterbox + spriteRootPivot * s`. Сейчас offset=(140, 233.625) DIP, SVG `xMidYMid meet`.
- Position adapter получает готовый `pivotOffset`: root↔native, rounding/clamp/commit; scale/letterbox не считает. Main компонует размеры/DI без собственных CSS/Render constants. Меню сохраняет origin/root offset; DPR к DIP не применяется, physical-pixel conversion — platform adapters.
- Skin совмещает frame pivot с canonical root. Flip/squash/смена клипа не меняют native offset/position authority. Исходный `canvasSize` передаётся отдельно от fixed viewport; нестандартный frame не меняет масштаб всего canvas.

Проверки: `tests/shared/pet-presentation-layout.test.ts` — asymmetric letterbox, compact/expanded parity; Renderer — canonical root при frame change и нестандартные canvas/pivots.

### Renderer-local Skin contract

[skin-engine.ts](../../src/renderer/render-engine/skin-engine.ts): `ISkinEngine`, `BodyVisualState`, reflex types — только Renderer, не Application port/shared IPC.

| `BodyVisualState` поле | Назначение | Инвариант |
|---|---|---|
| `streamId` | Связывает projection с текущим Brain stream | Непустой trusted ID; при replacement создаётся новый Skin lifecycle. |
| `revision` | Порядок полных visual projections, включая локальные reflex updates | Положительный safe integer; update с уже применённой revision не публикуется повторно. |
| `visualIntent` | Immutable semantic intent текущего Brain episode | Для пары `(streamId, episodeId)` payload неизменен; asset keys отсутствуют. |
| `visualAgeMs` | Same-clock baseline возраста visual episode, вычисленный Body | Равен `sampledAtMs - episodeStartedAtMs`, конечен и неотрицателен; Skin не сравнивает Main и Renderer clocks. |
| `reflex.pupilOffset` | Renderer-local смещение взгляда | Обе компоненты конечны и нормализованы в `[-1, 1]`; не пересекают IPC. |
| `reflex.transform` | `flipX`, `scaleX`, `scaleY`, `rotationDeg` для gaze/drag squash/stretch | Числа конечны, масштабы положительны; transform не меняет motion authority. |

| Операция `ISkinEngine` | Назначение | Инвариант lifecycle |
|---|---|---|
| `init()` | Создать renderer-local resources | Идемпотентна в рамках одного instance lifecycle. |
| `update(state)` | Применить последнюю полную `BodyVisualState` | Не принимает partial patch; повтор revision не создаёт React/render update. |
| `destroy()` | Остановить RAF/player callbacks и освободить resources | После возврата новые updates запрещены. |

`SpriteSkinAdapter` — единственный adapter scope, оборачивает текущие resolver/player/renderer/manifest без format migration. Base clip стартует/replay только при новой паре `(streamId, visualIntent.episodeId)` с baseline `visualAgeMs`; Brain revision/reflex старого episode не сбрасывают playback. Completion локален, не входит в `BodyEventDTO` и не создаёт Brain outcome.

Spine/Live2D, placeholders, dependencies/adapter IDs вне AUTO-A08/AUTO-I10; требуют отдельных Dependency/Implementation Gate и готовых rig assets.

## 1. Manifest & Asset Metadata

Реестр: `public/assets/sprites/manifest.json`.

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

Текущие назначения/allowedFaceKeys — в [manifest.json](../../public/assets/sprites/manifest.json): overlay у body_idle/stand_up/sit/lie, baked-in у motion/reaction body_walk/run/dragged/fall/land/sleep. Каталог конкретных face keys читается из манифеста, не копируется сюда.

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
