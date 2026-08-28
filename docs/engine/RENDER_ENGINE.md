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
export type SynthesizedEmotionalTone =
  | 'shy'
  | 'sleepy'
  | 'playful'
  | 'curious'
  | 'neutral'
  | 'affectionate'
  | 'flustered';

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

export interface SpriteFrameDef {
  readonly source: string;
  readonly sourceRect?: SpriteRect;
  readonly bounds?: SpriteRect;
  readonly durationMs?: number;
  readonly pivot?: SpritePoint;
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
  readonly emotionalTone?: SynthesizedEmotionalTone;
  readonly tags?: readonly string[];
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

### 1.3. Frame Timing

Render Engine supports `frame.durationMs` for per-frame timing and `animation.fps` for uniform frame timing.

If both are absent, the engine uses:

```typescript
export const DEFAULT_SPRITE_FPS = 8;
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

export interface RenderableFrameDef extends SpriteFrameDef {
  readonly source: string;
}

export interface RenderLayerBase {
  readonly id: NonProceduralRenderLayerId;
  readonly category: SpriteLayerCategory;
  readonly zIndex: number;
  readonly animationKey?: SpriteAnimationKey;
  readonly pivot: SpritePoint;
  readonly offset: SpritePoint;
  readonly opacity: number;
  readonly blendMode: RenderBlendMode;
}

export interface VisibleRenderLayerDef extends RenderLayerBase {
  readonly visible: true;
  readonly frame: RenderableFrameDef;
}

export interface HiddenRenderLayerDef extends RenderLayerBase {
  readonly visible: false;
  readonly frame?: RenderableFrameDef;
}

export type RenderLayerDef = VisibleRenderLayerDef | HiddenRenderLayerDef;

export interface ProceduralBlushDef {
  readonly id: 'procedural_blush';
  readonly intensity: number; // 0..1
  readonly blendMode: 'normal';
  readonly color: string;
  readonly leftCheek: SpritePoint;
  readonly rightCheek: SpritePoint;
  readonly radius: number;
  readonly opacity: number;
}

export interface RenderPresentationState {
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly rootPivot: SpritePoint;
  readonly transform: {
    readonly flipX: boolean;
    readonly scale: number;
  };
  readonly layers: readonly RenderLayerDef[];
  readonly proceduralBlush?: ProceduralBlushDef;
}
```

Normative Z-order:

| Order | Layer | Z-index | Blend | Notes |
|---|---|---:|---|---|
| 1 | `base_body` | 10 | `normal` | Required. Exactly one body layer must be present after fallback. |
| 2 | `face` | 20 | `normal` | Optional full face layer. |
| 3 | `expression` | 21 | `normal` | Optional partial expression above face. |
| 4 | `procedural_blush` | 30 | `normal` | Optional procedural layer, driven by `expressionHint: 'blush'` or tone. |
| 5 | `prop_pillow` | 40 | `normal` | Optional prop from `propHint: 'pillow'`. |
| 6 | `prop_heart` | 41 | `normal` or `additive` | Optional prop from `propHint: 'heart'`. |
| 7 | `prop_question` | 42 | `normal` | Optional prop from `propHint: 'question'`. |
| 8 | `prop_sparkle` | 43 | `screen` or `additive` | Optional prop from `propHint: 'sparkle'`. |

Composition invariants:

- `base_body` is the only mandatory visual layer.
- Procedural blush is not a behavior state; it is a render overlay derived from resolved tone/expression.
- Props never change `AnimationIntent.kind`, `priority`, `interrupt` or `loop`.
- Missing optional layers are omitted from `RenderPresentationState`, not represented by broken paths.
- All layer geometry uses the same coordinate system and root pivot.
- Every `visible === true` non-procedural `RenderLayerDef` must include a fully resolved `frame`.
- Renderer must never resolve `frame` from `animationKey`; `animationKey` is diagnostic metadata only.
- Normative order is `body -> full face -> partial expression -> blush -> props/fx`.

### 2.1. Geometry & Transform Contract

- The origin is the top-left corner of `viewport`.
- `+X` points right.
- `+Y` points down.
- `pivot` is a local point inside the layer frame.
- `rootPivot` is the stable transform origin for the whole character composition.
- A layer is positioned so its `pivot` matches `rootPivot + offset`.
- `flipX` and `scale` apply to the whole composition around `rootPivot`.
- `proceduralBlush` transforms together with the character.
- `rootPivot` does not change just because the active body frame changes.

```text
viewport = 512x512
rootPivot = { x: 256, y: 460 }
layer pivot = { x: 128, y: 220 }
offset = { x: 10, y: -20 }
layer top-left before global transform:
{ x: 256 + 10 - 128, y: 460 - 20 - 220 } = { x: 138, y: 220 }
```

## 3. Animation Clip, Tracks & Player

`ResolvedAnimationClip` is the resolver output consumed by Animation Player. It is semantic enough for playback, but not for behavior decisions.

```typescript
export type TrackPlaybackMode = 'loop' | 'hold' | 'once';

export interface ResolvedTrackBase {
  readonly id: NonProceduralRenderLayerId;
  readonly category: SpriteLayerCategory;
  readonly animationKey: SpriteAnimationKey;
  readonly frames: readonly RenderableFrameDef[];
  readonly fps?: number;
  readonly zIndex: number;
  readonly pivot?: SpritePoint;
  readonly offset?: SpritePoint;
  readonly opacity?: number;
  readonly blendMode?: RenderBlendMode;
}

export interface ResolvedBodyTrack extends ResolvedTrackBase {
  readonly id: 'base_body';
  readonly category: 'body';
  readonly playbackMode?: never;
}

export interface ResolvedOverlayTrack extends ResolvedTrackBase {
  readonly category: 'face' | 'expression' | 'props';
  readonly playbackMode?: TrackPlaybackMode;
}

export interface ResolvedAnimationClip {
  readonly key: SpriteAnimationKey;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly rootPivot: SpritePoint;
  readonly transform: { readonly flipX: boolean; readonly scale: number };
  readonly body: ResolvedBodyTrack;
  readonly face?: ResolvedOverlayTrack & { readonly category: 'face' };
  readonly expression?: ResolvedOverlayTrack & { readonly category: 'expression' };
  readonly props?: readonly (ResolvedOverlayTrack & { readonly category: 'props' })[];
  readonly proceduralBlush?: ProceduralBlushDef;
}

export type AnimationLoopMode =
  | { type: 'none' }
  | { type: 'until_replaced' }
  | { type: 'bounded'; count: number };

export interface AnimationCompletedEvent {
  readonly clipKey: string;
  readonly loopCount: number;
  readonly sessionElapsedMs: number;
}

export type AnimationCompletedListener = (event: AnimationCompletedEvent) => void;

export interface IAnimationPlayer {
  play(clip: ResolvedAnimationClip, loopMode: AnimationLoopMode): void;
  tick(deltaMs: number): void;
  onCompleted(listener: AnimationCompletedListener): () => void;
  destroy(): void;
}
```

- `loop`: active frame is resolved from `elapsedMs % cycleDuration`.
- `hold`: plays normally until track end, then keeps the last frame.
- `once`: plays normally until track end, then removes that layer from `RenderPresentationState`.

| Track | Default mode |
|---|---|
| `face` | `hold` |
| `expression` | `hold` |
| physical `props` | `hold` |
| effect-like `props` / `fx` | `loop` |

Player invariants:

- `play()` starts a new session with `elapsedMs = 0`.
- First `RenderPresentationState` is emitted immediately.
- Replacing an unfinished animation does not emit a completion event for the previous animation.
- Body playback is controlled only by `AnimationLoopMode`; `TrackPlaybackMode` applies only to `face`, `expression` and `props`.
- Player is passive and tick-driven; it does not own `requestAnimationFrame`, `setInterval` or platform timers.
- `deltaMs <= 0`, `NaN` and `Infinity` are no-op.
- `{ type: 'none' }` completes after one body cycle.
- `{ type: 'bounded', count }` completes after `count` body cycles; `count < 1` is normalized to `1`.
- `{ type: 'until_replaced' }` does not complete by itself.
- Large `deltaMs` jumps are resolved mathematically, not frame-by-frame.
- Terminal completion clamps elapsed time to terminal time, uses the last body frame, emits final `RenderPresentationState`, marks completed, then notifies listeners exactly once.
- Further `tick()` calls after completion are no-op until the next `play()`.
- `destroy()` is idempotent; calls after destroy are safe no-op.

## 4. Character Renderer Port

```typescript
export interface ICharacterRenderer {
  render(state: RenderPresentationState): void;
  preload?(sources: readonly string[]): Promise<void>;
  destroy(): void;
}
```

Renderer port invariants:

- `render()` receives only presentation DTOs.
- Renderer does not know `AnimationIntent`, FSM, behavior state or semantic clip selection.
- `preload()` is a performance optimization, not a correctness requirement.
- The application must work correctly without prior `preload()`.
- `destroy()` is idempotent.

### 4.1. Async Asset Loading & Race Contract

Renderer implementation may maintain four technical concepts:

- **desired presentation state:** latest state passed to `render(state)`;
- **committed/displayed state:** state currently visible on screen;
- **texture cache:** decoded assets keyed by frame `source`;
- **pending asset loads:** in-flight loads keyed by frame `source`.

Rules:

1. `render(state)` updates desired state.
2. Ready textures are reused from cache.
3. Duplicate loads for the same `source` must not start concurrently.
4. A completed async load may always enter cache.
5. A completed async load is displayed only if current desired state still uses that `source`.
6. An old load must never restore an outdated visual state.

Mandatory invariant:

```text
render(body=A)
load A started

render(body=B)
load B started

B loaded -> B displayed

A loaded later
-> cached
-> NOT displayed
```

Renderer works only with presentation generations and asset identity. It must not reason in terms of clips or FSM transitions.

## 5. Intent-to-Asset Resolution

Resolver input is the semantic `AnimationIntent` defined in `ANIMATION_ENGINE.md`.

Resolution order:

1. Map `AnimationIntent.kind` to a candidate body key.
2. Prefer a tone-specialized key when present, for example `<bodyKey>_<emotionalTone>`.
3. Resolve `expressionHint` to `face_*`, `expression_*` or procedural blush.
4. Resolve `propHint` to `prop_pillow`, `prop_heart`, `prop_question` or `prop_sparkle`.
5. Resolve `viewport`, `rootPivot` and `transform`.
6. Apply graceful fallback if any required or requested asset is absent.

Resolver defaults:

```text
viewport  -> body.canvasSize -> { width: 512, height: 512 }
rootPivot -> body.pivot -> { x: 256, y: 460 }
flipX     -> false
scale     -> 1
```

`rootPivot` is stable for one `ResolvedAnimationClip` and is never taken from the current body frame.

Default body key mapping:

| `AnimationIntent.kind` | Preferred body key | Level 2 base |
|---|---|---|
| `walk` | `body_walk` | `body_walk` |
| `idle_blink`, `settle` | `body_idle` | `body_idle` |
| `thinking_loop`, `talking` | `body_thinking` | `body_idle` |
| `happy_reaction` | `body_petting` | `body_idle` |
| `confused_reaction`, `spook` | `body_idle` | `body_idle` |
| `sleep_start` | `body_sleep_trans` | `body_idle` |
| `sleep_loop` | `body_sleep` | `body_idle` |
| `wake_up`, `land` | `body_land` | `body_idle` |
| `dragged` | `body_dragged` | `body_idle` |

## 6. Graceful Fallback

Incomplete asset packs are expected during MVP. Missing or corrupt graphics must never crash Animation FSM, stall a bounded sequence or mutate Character Engine state.

### Level 1: Exact Semantic Match

Use the best available asset set for:

```text
AnimationIntent.kind + AnimationIntent.emotionalTone
```

Then attach matching `expressionHint` and `propHint` layers if available.

Example: `walk + playful` may resolve to a specialized playful walk body, a wink expression and sparkle prop.

### Level 2: Base Category + Procedural/Prop Overlay

If no exact body variant exists, use a safe base body cycle:

- `body_walk` for movement/wander/walk.
- `body_idle` for idle, dialogue, reaction, sleep, transition and unknown categories.

Then preserve semantic hints independently where possible:

- `expressionHint: 'blush'` may become `procedural_blush`.
- `propHint: 'pillow'` may become `prop_pillow`.
- `propHint: 'heart'` may become `prop_heart`.
- `propHint: 'question'` may become `prop_question`.
- `propHint: 'sparkle'` may become `prop_sparkle`.

Level 2 changes visual richness only. It does not rewrite `AnimationIntent.kind`, `emotionalTone`, `priority`, `interrupt` or `loop`.

### Level 3: System Baseline

If no safe category base can be loaded, Render Engine falls back to a built-in static baseline visual:

```text
system://wisp/default_idle.svg
```

Level 3 guarantees:

- The Animation FSM continues to advance.
- Bounded animations still complete.
- `sleep_loop` remains a sleep FSM state even if it is displayed as a calm idle baseline.
- Critical interaction states such as `dragged` remain active in FSM even if the visual representation is simplified.
- Resolver returns a renderable state instead of throwing into user-facing flow.

### 6.1. Technical Fallback

Technical fallback belongs to renderer asset loading, not semantic resolution. A physical I/O failure must not be sent back through Asset/Fallback Resolver.

On body frame load failure:

```text
previous committed body frame
  -> built-in system://wisp/default_idle.svg
```

On optional layer load failure:

```text
face / expression / prop failure
  -> omit or hide only that layer
```

FSM and Animation Player continue to advance after technical fallback.

## 7. Clean Architecture Boundaries

Render Engine contract is framework-neutral.

- Domain and Application contracts do not import renderer implementation classes.
- Renderer receives presentation DTOs; it does not receive mutable domain models.
- Manifest schema contains asset metadata only; it does not contain behavior rules, AI prompts, provider settings or OS-specific paths.
- UI components may display `RenderPresentationState`, but UI code does not own asset resolution, fallback policy or animation FSM decisions.
- No React hooks, Vite plugins, CSS-framework class names, DOM selectors, Electron window handles, Node.js objects, external AI SDKs or backend/proxy/server concepts are part of this document.

## 8. Acceptance Checklist for Implementers

- Manifest loader accepts the current flat MVP manifest and the canonical `animations` registry shape.
- `SpriteFrameDef` supports `durationMs`, `pivot` and `sourceRect`.
- `RenderPresentationState` includes `viewport`, stable `rootPivot` and global `transform`.
- Layer composition follows `base_body -> face/expression -> procedural_blush -> props`.
- Layer-order tests assert `face` at z-index `20` and `expression` at z-index `21`.
- `IAnimationPlayer` and `ICharacterRenderer` match the port behavior defined above.
- Async asset loading follows desired/committed state race rules.
- Graceful fallback has exactly three observable levels and never crashes or rewrites FSM state.
- Technical fallback handles physical load failures without re-entering semantic resolver.
- Tests for implementation tasks should cover manifest validation, frame timing, layer order and all fallback levels.
