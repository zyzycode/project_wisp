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
