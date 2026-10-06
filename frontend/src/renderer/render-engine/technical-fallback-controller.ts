import type { RenderLayerDef, VisibleRenderLayerDef } from './types';

/** Renderer-owned handling of physical asset failures; semantic resolution remains untouched. */
export class TechnicalFallbackController {
  private readonly failedSources = new Set<string>();
  private previousBodyLayer: VisibleRenderLayerDef | undefined;

  resolve(layer: RenderLayerDef): RenderLayerDef | undefined {
    if (!layer.visible || !this.failedSources.has(layer.frame.source)) return layer;
    if (layer.category !== 'body') return undefined;
    return this.previousBodyLayer ?? createSystemBodyLayer(layer);
  }

  recordLoaded(layer: VisibleRenderLayerDef): void {
    if (layer.category === 'body' && layer.frame.source !== 'system://wisp/default_idle.svg') {
      this.previousBodyLayer = layer;
    }
  }

  recordFailed(layer: VisibleRenderLayerDef, failedSource: string): boolean {
    if (failedSource !== layer.frame.source || this.failedSources.has(failedSource)) return false;
    this.failedSources.add(failedSource);
    return true;
  }
}

function createSystemBodyLayer(layer: VisibleRenderLayerDef): VisibleRenderLayerDef {
  return {
    ...layer,
    animationKey: 'system_default_idle',
    frame: {
      source: 'system://wisp/default_idle.svg',
      pivot: layer.pivot,
    },
  };
}
