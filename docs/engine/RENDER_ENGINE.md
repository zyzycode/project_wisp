# Контракт Render Engine

`RENDER_ENGINE.md` - source of truth для визуального слоя Project Wisp: манифеста спрайтов, нарезки кадров, таймингов, композиции слоев и fallback-резолвинга.

Документ является архитектурным контрактом ядра. Implementer-агенты не меняют этот contract без Architect review.

## Владение

Render Engine не принимает решений о поведении персонажа. Он получает уже принятый `AnimationIntent` из Animation Engine и превращает его в presentation-ready описание визуальных слоев.

```text
Character Engine
  -> AnimationIntent
  -> Animation Controller
  -> Asset/Fallback Resolver
  -> Animation Player
  -> RenderPresentationState
  -> ICharacterRenderer
```

- **Animation Engine:** владеет `AnimationIntent`, `kind`, `category`, `priority`, `interrupt`, `loop`, `emotionalTone`, `expressionHint` и `propHint`.
- **Asset/Fallback Resolver:** выбирает конкретные animation keys из `manifest.json`, строит слои и применяет graceful fallback.
- **Animation Player:** вычисляет активный frame по времени и loop policy.
- **ICharacterRenderer:** детерминированно отображает `RenderPresentationState`.

Renderer не парсит provider DTO, не вычисляет `Needs`, не меняет FSM, не знает причины выбранного поведения и не импортирует UI-framework hooks, Vite plugins, CSS-framework classes или platform-specific APIs.

## 1. Manifest & Asset Metadata

`public/assets/sprites/manifest.json` является реестром доступных визуальных ресурсов. Текущий MVP-манифест уже содержит плоскую карту ключей вида `body_idle`, `body_walk`, `face_happy`. Контракт ниже фиксирует целевую v1-схему и правила нормализации для существующей плоской формы.

### 1.1. Идентификаторы и категории

Animation key обязан быть стабильным snake_case идентификатором:

```text
<layer>_<name>[_<variant>]
```

Разрешенные верхнеуровневые категории:

| Layer category | Назначение | Примеры keys | Manifest category |
|---|---|---|---|
| `body` | Базовый силуэт и поза персонажа | `body_idle`, `body_walk`, `body_sleep`, `body_dragged`, `body_land` | `body/<name>` |
| `face` | Полная дорожка лица или мимики | `face_idle`, `face_happy`, `face_sleepy` | `face/<name>` или legacy `faces/<name>` |
| `expression` | Частичная мимика поверх лица | `expression_blush`, `expression_wink`, `expression_pout` | `expression/<name>` |
| `props` | Реквизит и визуальные эффекты | `prop_pillow`, `prop_heart`, `prop_question`, `prop_sparkle` | `props/<name>` |

Нормативные правила:

- `body_*` используется только для базового слоя тела.
- `face_*` и `expression_*` не могут заменять тело в fallback-цепочке.
- `prop_*` используется для физического реквизита, например `pillow`.
- `fx_*` допускается как alias для легких эффектов, но в Render Engine нормализуется в категорию `props`.
- Legacy category `faces/<name>` из текущего манифеста читается как `face/<name>` без изменения файла ассетов.

### 1.2. TypeScript-интерфейсы манифеста

Manifest field `emotionalTone` использует authoritative `SynthesizedEmotionalTone` из [`CHARACTER_ENGINE.md`](./CHARACTER_ENGINE.md#8-эмоциональный-тон-синтез-настроения). Render Engine не переопределяет словарь и не выводит tone или sleep state из visual assets.

```typescript
export type SpriteLayerCategory = 'body' | 'face' | 'expression' | 'props';

export type SpriteAnimationCategory =
  | `body/${string}`
  | `face/${string}`
  | `faces/${string}` // legacy alias for current MVP manifest
  | `expression/${string}`
  | `props/${string}`
  | `fx/${string}`; // normalized to props

export type SpriteAnimationKey = string;

export interface SpritePoint {
  readonly x: number;
  readonly y: number;
}

export interface SpriteRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SpriteAnchors {
  readonly [anchorName: string]: SpritePoint | undefined;
}

export interface SpriteFrameMeta {
  readonly anchors?: SpriteAnchors;
}

export interface SpriteFrameDef {
  readonly source: string;
  readonly sourceRect?: SpriteRect;
  readonly bounds?: SpriteRect;
  readonly durationMs?: number;
  readonly pivot?: SpritePoint;
  readonly anchors?: SpriteAnchors;
  readonly meta?: SpriteFrameMeta;
}

export interface SpriteAnimationDef {
  readonly category: SpriteAnimationCategory;
  readonly layer?: SpriteLayerCategory;
  readonly frames: readonly (string | SpriteFrameDef)[];
  readonly framesCount?: number;
  readonly fps?: number;
  readonly pivot?: SpritePoint;
  readonly canvasSize?: { readonly width: number; readonly height: number };
  readonly sourceRect?: SpriteRect;
  readonly sourceFile?: string;
  readonly defaultAnchors?: SpriteAnchors;
  readonly frameMeta?: readonly SpriteFrameMeta[];
  readonly faceOverlay?: BodyFaceOverlayCompatibility;
  readonly emotionalTone?: SynthesizedEmotionalTone;
  readonly tags?: readonly string[];
}

export type BodyFaceOverlayMode = 'overlay' | 'baked_in' | 'none';

export interface BodyFaceOverlayCompatibility {
  /** `overlay` requires a non-empty list; other modes require no face keys. */
  readonly mode: BodyFaceOverlayMode;
  /** Full face-layer keys permitted on this body animation. */
  readonly allowedFaceKeys?: readonly SpriteAnimationKey[];
  /** Key used when the requested allowed face is unavailable, or `none`. */
  readonly fallback: SpriteAnimationKey | 'none';
  /** Required only for `overlay`; names the body anchor used by the face layer. */
  readonly anchor?: string;
}

export interface SpriteManifest {
  readonly schemaVersion?: 1;
  readonly animations?: Record<SpriteAnimationKey, SpriteAnimationDef>;
  readonly [animationKey: SpriteAnimationKey]:
    | 1
    | Record<SpriteAnimationKey, SpriteAnimationDef>
    | SpriteAnimationDef
    | undefined;
}
```

Validation rules:

- `frames` must be non-empty.
- If `framesCount` is present, it must equal `frames.length`.
- `fps` and `durationMs`, when present, must be greater than `0`.
- `sourceRect` and `canvasSize`, when present, must have positive width and height.
- `pivot.x` and `pivot.y` are measured in source pixels.
- Paths must be relative asset paths or public-root paths such as `/assets/sprites/body/walk/body_walk_00.png`; path traversal via `..` is invalid.
- Missing `schemaVersion` does not invalidate the current MVP manifest. Loader must normalize the flat object into an internal `animations` registry before resolving assets.
- `faceOverlay` is body-only metadata. It is intentionally ignored by the current resolver until P13-F04 consumes it; this keeps the contract and asset audit separate from Renderer implementation work.

### 1.3. Frame Timing

Render Engine supports `frame.durationMs` for per-frame timing and `animation.fps` for uniform frame timing.

If both are absent, the engine uses:

```typescript
export const DEFAULT_SPRITE_FPS = 3;
```

Frame duration is resolved in this order:

```text
frame.durationMs
  -> 1000 / animation.fps
  -> 1000 / DEFAULT_SPRITE_FPS
```

The Animation Player uses elapsed monotonic time, not wall-clock time. Large `deltaMs` jumps advance to the mathematically correct frame or completion state instead of stepping one frame at a time.

### 1.4. Sprite Slicing

- Separate PNG frames may be represented as strings in `frames`; atlas frames must use `SpriteFrameDef.sourceRect`.
- `sourceRect` coordinates are relative to the top-left corner of `source`.
- `pivot` is resolved per frame as `frame.pivot -> animation.pivot -> layer default`.
- Body layer default pivot is the root contact point of the character.
- Non-body layers should define explicit pivots so face, expression and prop layers remain stable across body frames.

### 1.5. Body-to-face compatibility

Every `body_*` entry **must** declare `faceOverlay`. It is the machine-readable authority for whether a full `face_*` track may be composed over that body; neither an `AnimationIntent` nor a resolver fallback may infer this from key names.

| Mode | Meaning | Required metadata | Render result |
|---|---|---|---|
| `overlay` | The body PNG has no complete face at the compatible location. | Non-empty `allowedFaceKeys`, `fallback`, and `anchor`. | Select only a listed `face_*` key; if it is missing, use `fallback`, or hide the face when it is `none`. |
| `baked_in` | Every body frame already contains its own complete face. | `fallback: "none"`; no `allowedFaceKeys` or `anchor`. | Never draw a full face overlay. Partial `expression_*` remains a separate, explicitly opted-in layer. |
| `none` | This pose has no safe full-face composition and does not contain a usable baked face. | `fallback: "none"`; no `allowedFaceKeys` or `anchor`. | Hide the full face layer. The asset must appear in the artist-action list below. |

Validation rules for a future manifest generator/validator:

- `faceOverlay` is required for every `body_*` animation and forbidden for `face_*`, `expression_*`, and `prop_*` animations.
- `overlay` accepts only keys whose manifest category normalizes to `face/*`. `allowedFaceKeys` is a compatibility allow-list, not a request to play every key.
- `overlay` requires exactly one named body anchor. Its `fallback` is either one member of `allowedFaceKeys` or `none`.
- `baked_in` and `none` must set `fallback` to `none` and must omit `allowedFaceKeys` and `anchor`; this makes accidental double faces and guessed placement invalid metadata.
- A partial `expression_*` is not a `face_*` replacement. It may be composed only by its own future compatibility declaration and does not relax the rules above.

Current audited compatibility map (PNG inspection, 2026-08-29):

| Body key | Mode | Full-face fallback | Reason |
|---|---|---|---|
| `body_idle` | `baked_in` | `none` | Character face is present in all eight body frames. |
| `body_walk` | `baked_in` | `none` | Face is painted into the walking pose. |
| `body_thinking` | `baked_in` | `none` | Face is painted into the thinking pose. |
| `body_dragged` | `baked_in` | `none` | Face is painted into the dragged pose. |
| `body_land` | `baked_in` | `none` | Face is painted into the landing pose. |
| `body_sleep_trans` | `baked_in` | `none` | Closed-eye face is painted into the transition. |
| `body_sleep` | `baked_in` | `none` | Sleeping face is painted into the pose. |
| `body_petting` | `baked_in` | `none` | Happy face is painted into the pose. |
| `body_wave` | `baked_in` | `none` | Face is painted into the waving pose. |
| `body_celebrate` | `baked_in` | `none` | Face is painted into the celebration pose. |
| `body_scared` | `baked_in` | `none` | Scared face is painted into the pose. |
| `body_bored` | `baked_in` | `none` | Face is painted into the bored pose. |

The current `face_*` PNGs are transparent, full-canvas eye tracks. They are **not** compatible with the audited body files, because each body already contains eyes and a complete face. There are no current `none` bodies; therefore this audit creates no immediate artist-action item. Before changing any row to `overlay`, the artist must supply a body sequence without a complete face (or a verified removable face region) and record its compatible face keys and anchors.

### 1.6. Face anchor and pivot coordinate system

All coordinates are source-canvas pixels in one coordinate system: origin `(0, 0)` is the top-left of the unscaled frame canvas; `x` grows right and `y` grows down. They are never CSS pixels, cropped-display pixels, or normalized percentages. `canvasSize` describes that source canvas; frames in one composable body/face pair must have the same canvas dimensions unless the manifest explicitly supplies a conversion contract in a future schema.

- A body `pivot` is the root/contact point used to place the body in world space. It resolves `frame.pivot -> animation.pivot -> body default`.
- A body anchor named by `faceOverlay.anchor` is the target position for the face-layer pivot. It resolves `frameMeta[frameIndex].anchors[name] -> defaultAnchors[name]`; a missing anchor makes that overlay pair invalid rather than guessed.
- A face frame's `pivot` is the local source-canvas point aligned with the selected body frame's anchor. It resolves `faceFrame.pivot -> faceAnimation.pivot`; overlay assets must provide an explicit value at one of these levels.
- `frameMeta` is index-aligned to the body `frames` array. Empty objects are permitted to inherit `defaultAnchors`; the array may be shorter than `frames`, in which case absent entries also inherit. A generator must preserve existing manual entries and may add only the needed per-frame overrides.
- A body frame and face frame need not have equal frame counts. The Animation Player chooses each track's frame by its own timing; placement always reads the currently selected body frame's anchor and face frame's pivot.

Example of a future overlay-ready body entry (illustrative only; not present in the current asset pack):

```json
{
  "category": "body/idle",
  "canvasSize": { "width": 512, "height": 512 },
  "pivot": { "x": 256, "y": 460 },
  "defaultAnchors": { "face": { "x": 256, "y": 126 } },
  "frameMeta": [
    {},
    { "anchors": { "face": { "x": 256, "y": 124 } } }
  ],
  "faceOverlay": {
    "mode": "overlay",
    "allowedFaceKeys": ["face_happy", "face_sad"],
    "fallback": "face_happy",
    "anchor": "face"
  }
}
```

### 1.7. Стандарт количества кадров (Frame Count Contract)

> [!IMPORTANT]
> **ПРАВИЛО КОЛИЧЕСТВА КАДРОВ В АНИМАЦИЯХ:**
> 1. **Минимум 4 кадра на анимацию:** Любая анимация персонажа (`body_*`), оверлея лица (`face_*`), изолированных зрачков (`pupils_*`) и эффектов должна содержать **4 или более кадров** (`>= 4 frames`).
> 2. **Запрет 2- и 3-кадровых анимаций:** Короткие 2- и 3-кадровые анимации **не допускаются**, так как они вызывают стробоскопический эффект и визуальные рывки при интерполяции слоёв.
> 3. **Стандартная раскладка спрайт-шитов:**
>    - **4 кадра (базовый стандарт):** 1 горизонтальный ряд × 4 колонки (`1 row × 4 columns wide strip` / файлы `_00.png`..`_03.png`).
>    - **8 кадров (расширенный стандарт, например `body_idle`):** 2 ряда × 4 колонки (`2 rows × 4 columns` / файлы `_00.png`..`_07.png`).
>    - Допускаются более длинные последовательности (>= 4 кадров), если это требуется для плавности сложного перехода или действия.

## 2. Layer Ordering & Blend

The resolved render state is a deterministic stack. Later layers draw over earlier layers.

```typescript
export type RenderLayerId =
  | 'base_body'
  | 'face'
  | 'expression'
  | 'procedural_blush'
  | 'prop_pillow'
  | 'prop_heart'
  | 'prop_question'
  | 'prop_sparkle';

export type NonProceduralRenderLayerId = Exclude<RenderLayerId, 'procedural_blush'>;
export type RenderBlendMode = 'normal' | 'multiply' | 'screen' | 'additive';

export interface VisibleRenderLayerDef {
  readonly id: RenderLayerId;
  readonly category: SpriteLayerCategory;
  readonly zIndex: number;
  readonly pivot: SpritePoint;
  readonly offset: SpritePoint;
  readonly opacity: number;
  readonly blendMode: RenderBlendMode;
  readonly visible: boolean;
  readonly frame: RenderableFrameDef;
}
```

Normative Z-indexes:

- `10` — `base_body`
- `20` — `face`
- `21` — `expression`
- `30` — `procedural_blush`
- `40` — `prop_pillow`
- `41` — `prop_heart`
- `42` — `prop_question`
- `43` — `prop_sparkle`

Rules:

- Procedural blush uses SVG radial gradient tint over the cheeks area without replacing sprite layers.
- Prop overlays align relative to the character root pivot.
- Props with `blendMode: 'additive'` or `blendMode: 'screen'` render without clipping the base body.

## 3. Fallback Resolver Algorithm

```text
1. Primary Intent Match:
   (kind, tone, expressionHint, propHint) -> exact manifest keys

2. Tone Fallback:
   If body_<kind>_<tone> missing -> body_<kind> -> body_idle

3. Expression Fallback:
   If face_<expressionHint> missing -> face_idle -> hide face overlay

4. Prop Fallback:
   If prop_<propHint> missing -> skip prop layer (silent degradation, no error)

5. Level 3 (Emergency):
   If body_idle missing -> procedural fallback placeholder with warning log
```

Fallback never throws uncaught exceptions during active gameplay. Missing optional overlays must gracefully degrade to base body rendering.
