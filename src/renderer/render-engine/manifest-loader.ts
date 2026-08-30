import {
  DEFAULT_FACE_FPS,
  DEFAULT_FACE_PIVOT,
  DEFAULT_SPRITE_FPS,
  DEFAULT_SPRITE_PIVOT,
  type NormalizedSpriteAnimationDef,
  type NormalizedSpriteFrameDef,
  type NormalizedSpriteManifest,
  type SpriteAnimationCategory,
  type SpriteAnimationDef,
  type SpriteAnchors,
  type BodyFaceOverlayCompatibility,
  type SpriteFrameMeta,
  type SpriteLayerCategory,
  type SpriteManifest,
  type SpritePoint,
  type SpriteRect,
} from './types';

/** Thrown when a manifest cannot safely be used by the render engine. */
export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

/** Validates either manifest v1 form and converts it into a single animations registry. */
export class ManifestLoader {
  load(manifest: unknown): NormalizedSpriteManifest {
    if (!isRecord(manifest)) {
      throw new ManifestValidationError('Sprite manifest must be an object.');
    }

    const schemaVersion = manifest.schemaVersion;
    if (schemaVersion !== undefined && schemaVersion !== 1) {
      throw new ManifestValidationError('Sprite manifest schemaVersion must be 1.');
    }

    const definitions = this.extractDefinitions(manifest as SpriteManifest);
    const animations: Record<string, NormalizedSpriteAnimationDef> = {};
    for (const [key, definition] of Object.entries(definitions)) {
      validateAnimationKey(key);
      animations[key] = normalizeAnimation(key, definition);
    }

    return { schemaVersion: 1, animations };
  }

  parse(manifest: unknown): NormalizedSpriteManifest {
    return this.load(manifest);
  }

  private extractDefinitions(manifest: SpriteManifest): Record<string, SpriteAnimationDef> {
    if (manifest.animations !== undefined) {
      if (!isRecord(manifest.animations)) {
        throw new ManifestValidationError('Sprite manifest animations must be an object.');
      }
      return manifest.animations as Record<string, SpriteAnimationDef>;
    }

    const definitions: Record<string, SpriteAnimationDef> = {};
    for (const [key, value] of Object.entries(manifest)) {
      if (key !== 'schemaVersion' && value !== undefined) {
        definitions[key] = value as SpriteAnimationDef;
      }
    }
    return definitions;
  }
}

function normalizeAnimation(key: string, definition: SpriteAnimationDef): NormalizedSpriteAnimationDef {
  if (!isRecord(definition)) {
    throw new ManifestValidationError(`Animation "${key}" must be an object.`);
  }
  const category = normalizeCategory(key, definition.category);
  const layer = definition.layer ?? categoryToLayer(category);
  if (layer !== categoryToLayer(category)) {
    throw new ManifestValidationError(`Animation "${key}" layer does not match its category.`);
  }
  if (!Array.isArray(definition.frames) || definition.frames.length === 0) {
    throw new ManifestValidationError(`Animation "${key}" must contain at least one frame.`);
  }
  if (definition.framesCount !== undefined && definition.framesCount !== definition.frames.length) {
    throw new ManifestValidationError(`Animation "${key}" framesCount must equal frames.length.`);
  }
  const defaultPivot = layer === 'face' || layer === 'expression' ? DEFAULT_FACE_PIVOT : DEFAULT_SPRITE_PIVOT;
  const defaultFps = layer === 'face' || layer === 'expression' ? DEFAULT_FACE_FPS : DEFAULT_SPRITE_FPS;
  const fps = validatePositiveNumber(definition.fps, `Animation "${key}" fps`) ?? defaultFps;
  const pivot = normalizePoint(definition.pivot, `Animation "${key}" pivot`) ?? defaultPivot;
  const sourceRect = normalizeRect(definition.sourceRect, `Animation "${key}" sourceRect`);
  const canvasSize = normalizeCanvasSize(definition.canvasSize, `Animation "${key}" canvasSize`);
  const defaultAnchors = normalizeAnchors(definition.defaultAnchors, `Animation "${key}" defaultAnchors`);
  const frameMeta = normalizeFrameMeta(definition.frameMeta, key);
  const faceOverlay = normalizeFaceOverlay(definition.faceOverlay, key, layer);

  const frames = definition.frames.map((frame, index) =>
    normalizeFrame(frame, key, index, fps, pivot, sourceRect, defaultAnchors, frameMeta?.[index])
  );

  return {
    key,
    category,
    layer,
    frames,
    framesCount: frames.length,
    fps,
    pivot,
    ...(canvasSize === undefined ? {} : { canvasSize }),
    ...(typeof definition.sourceFile === 'string' ? { sourceFile: definition.sourceFile } : {}),
    ...(defaultAnchors === undefined ? {} : { defaultAnchors }),
    ...(frameMeta === undefined ? {} : { frameMeta }),
    ...(faceOverlay === undefined ? {} : { faceOverlay }),
    ...(definition.emotionalTone === undefined ? {} : { emotionalTone: definition.emotionalTone }),
    tags: definition.tags === undefined ? [] : validateTags(definition.tags, key),
  };
}

function normalizeFaceOverlay(
  value: unknown,
  key: string,
  layer: SpriteLayerCategory
): BodyFaceOverlayCompatibility | undefined {
  if (value === undefined) return undefined;
  if (layer !== 'body') {
    throw new ManifestValidationError(`Animation "${key}" faceOverlay is only allowed on body animations.`);
  }
  if (!isRecord(value) || (value.mode !== 'overlay' && value.mode !== 'baked_in' && value.mode !== 'none')) {
    throw new ManifestValidationError(`Animation "${key}" faceOverlay must declare a valid mode.`);
  }
  if (value.fallback !== 'none' && typeof value.fallback !== 'string') {
    throw new ManifestValidationError(`Animation "${key}" faceOverlay must declare a fallback.`);
  }
  if (value.mode === 'overlay') {
    if (!Array.isArray(value.allowedFaceKeys) || value.allowedFaceKeys.length === 0 || !value.allowedFaceKeys.every((faceKey) => typeof faceKey === 'string') || typeof value.anchor !== 'string' || value.anchor.length === 0) {
      throw new ManifestValidationError(`Animation "${key}" overlay faceOverlay requires allowedFaceKeys and anchor.`);
    }
    if (value.fallback !== 'none' && !value.allowedFaceKeys.includes(value.fallback)) {
      throw new ManifestValidationError(`Animation "${key}" faceOverlay fallback must be allowed.`);
    }
    return { mode: 'overlay', allowedFaceKeys: [...value.allowedFaceKeys], fallback: value.fallback, anchor: value.anchor };
  }
  if (value.fallback !== 'none' || value.allowedFaceKeys !== undefined || value.anchor !== undefined) {
    throw new ManifestValidationError(`Animation "${key}" ${value.mode} faceOverlay must only declare fallback: "none".`);
  }
  return { mode: value.mode, fallback: 'none' };
}

function normalizeFrame(
  frame: string | import('./types').SpriteFrameDef,
  key: string,
  index: number,
  fps: number,
  animationPivot: SpritePoint,
  animationSourceRect: SpriteRect | undefined,
  defaultAnchors: SpriteAnchors | undefined,
  itemFrameMeta: SpriteFrameMeta | undefined
): NormalizedSpriteFrameDef {
  const definition = typeof frame === 'string' ? { source: frame } : frame;
  if (!isRecord(definition) || typeof definition.source !== 'string') {
    throw new ManifestValidationError(`Animation "${key}" frame ${index} must have a source path.`);
  }
  validateAssetPath(definition.source, `Animation "${key}" frame ${index}`);
  const durationMs = validatePositiveNumber(definition.durationMs, `Animation "${key}" frame ${index} durationMs`) ?? 1000 / fps;
  const pivot = normalizePoint(definition.pivot, `Animation "${key}" frame ${index} pivot`) ?? animationPivot;
  const sourceRect = normalizeRect(definition.sourceRect, `Animation "${key}" frame ${index} sourceRect`) ?? animationSourceRect;
  const bounds = normalizeRect(definition.bounds, `Animation "${key}" frame ${index} bounds`);

  // Frame anchors priority: explicit frameMeta[index].anchors -> definition.anchors -> defaultAnchors
  const frameLevelAnchors = normalizeAnchors(definition.anchors, `Animation "${key}" frame ${index} anchors`);
  const meta = itemFrameMeta ?? (definition.meta ? { anchors: normalizeAnchors(definition.meta.anchors, `Animation "${key}" frame ${index} meta.anchors`) } : undefined);
  const resolvedAnchors = meta?.anchors ?? frameLevelAnchors ?? defaultAnchors;

  return {
    source: definition.source,
    durationMs,
    pivot,
    ...(sourceRect === undefined ? {} : { sourceRect }),
    ...(bounds === undefined ? {} : { bounds }),
    ...(resolvedAnchors === undefined ? {} : { anchors: resolvedAnchors }),
    ...(meta === undefined ? {} : { meta }),
  };
}

function normalizeCategory(key: string, category: unknown): Exclude<SpriteAnimationCategory, `faces/${string}` | `fx/${string}`> {
  if (typeof category !== 'string') {
    throw new ManifestValidationError(`Animation "${key}" must have a category.`);
  }
  const [rawLayer, ...nameParts] = category.split('/');
  const name = nameParts.join('/');
  const normalizedLayer = rawLayer === 'faces' ? 'face' : rawLayer === 'fx' ? 'props' : rawLayer;
  if (!name || !isLayer(normalizedLayer)) {
    throw new ManifestValidationError(`Animation "${key}" has an unsupported category.`);
  }
  return `${normalizedLayer}/${name}` as Exclude<SpriteAnimationCategory, `faces/${string}` | `fx/${string}`>;
}

function categoryToLayer(category: string): SpriteLayerCategory {
  const layer = category.split('/')[0];
  if (!isLayer(layer)) {
    throw new ManifestValidationError(`Unsupported sprite layer "${layer}".`);
  }
  return layer;
}

function isLayer(value: string | undefined): value is SpriteLayerCategory {
  return value === 'body' || value === 'face' || value === 'expression' || value === 'props';
}

function validateAnimationKey(key: string): void {
  if (!/^(body|face|expression|prop|fx|pupils)_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key)) {
    throw new ManifestValidationError(`Animation key "${key}" must be a stable snake_case asset key.`);
  }
}

function validateAssetPath(path: string, context: string): void {
  if (!path || path.includes('..') || (!path.startsWith('/') && path.includes(':'))) {
    throw new ManifestValidationError(`${context} source must be a relative or public-root asset path without traversal.`);
  }
}

function validatePositiveNumber(value: unknown, context: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ManifestValidationError(`${context} must be a finite number greater than 0.`);
  }
  return value;
}

function normalizePoint(value: unknown, context: string): SpritePoint | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    throw new ManifestValidationError(`${context} must contain finite x and y coordinates.`);
  }
  return { x: value.x, y: value.y };
}

function normalizeAnchors(value: unknown, context: string): SpriteAnchors | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new ManifestValidationError(`${context} must be an object.`);
  }
  const anchors: Record<string, SpritePoint> = {};
  for (const [name, point] of Object.entries(value)) {
    if (point !== undefined) {
      const normalized = normalizePoint(point, `${context}.${name}`);
      if (normalized !== undefined) {
        anchors[name] = normalized;
      }
    }
  }
  return anchors;
}

function normalizeFrameMeta(value: unknown, key: string): readonly SpriteFrameMeta[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ManifestValidationError(`Animation "${key}" frameMeta must be an array.`);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new ManifestValidationError(`Animation "${key}" frameMeta[${index}] must be an object.`);
    }
    const anchors = normalizeAnchors(item.anchors, `Animation "${key}" frameMeta[${index}].anchors`);
    return {
      ...(anchors === undefined ? {} : { anchors }),
    };
  });
}

function normalizeRect(value: unknown, context: string): SpriteRect | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isPositiveNumber(value.width) || !isPositiveNumber(value.height)) {
    throw new ManifestValidationError(`${context} must contain finite x/y and positive width/height.`);
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function normalizeCanvasSize(value: unknown, context: string): { readonly width: number; readonly height: number } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isPositiveNumber(value.width) || !isPositiveNumber(value.height)) {
    throw new ManifestValidationError(`${context} must contain positive width and height.`);
  }
  return { width: value.width, height: value.height };
}

function validateTags(value: readonly string[], key: string): readonly string[] {
  if (!value.every((tag) => typeof tag === 'string')) {
    throw new ManifestValidationError(`Animation "${key}" tags must contain only strings.`);
  }
  return [...value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
