import React from 'react';

export interface AnimationInspectorProps {
  bodyAnimationKeys: readonly string[];
  faceAnimationKeys: readonly string[];
  selectedBodyKey: string | null;
  selectedFaceKey: string | null;
  showAnchorPoint: boolean;
  onSelectBody: (key: string | null) => void;
  onSelectFace: (key: string | null) => void;
  onToggleAnchorPoint: () => void;
}

export function normalizeInspectorSelection(value: string): string | null {
  return value.length === 0 ? null : value;
}

export function createInspectorSelectionHandler(
  onSelect: (key: string | null) => void,
  _targetType?: 'body' | 'face'
): (event: React.ChangeEvent<HTMLSelectElement>) => void {
  return (event) => {
    const rawVal = event.currentTarget?.value ?? event.target?.value ?? '';
    onSelect(normalizeInspectorSelection(rawVal));
  };
}

export const AnimationInspector: React.FC<AnimationInspectorProps> = ({
  bodyAnimationKeys,
  faceAnimationKeys,
  selectedBodyKey,
  selectedFaceKey,
  showAnchorPoint,
  onSelectBody,
  onSelectFace,
  onToggleAnchorPoint,
}) => {
  return (
    <section className="debug-hud-animations" data-testid="animation-inspector">
      <div className="debug-hud-section-title">🔎 Animation & Anchor Inspector</div>

      <label>
        Body clip
        <select
          data-testid="body-select"
          value={selectedBodyKey ?? ''}
          onChange={createInspectorSelectionHandler(onSelectBody, 'body')}
        >
          <option value="">(None / Reset)</option>
          {bodyAnimationKeys.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>

      <label>
        Face overlay
        <select
          data-testid="face-select"
          value={selectedFaceKey ?? ''}
          onChange={createInspectorSelectionHandler(onSelectFace, 'face')}
        >
          <option value="">(Auto from state)</option>
          {faceAnimationKeys.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={showAnchorPoint}
          onChange={onToggleAnchorPoint}
        />
        Show anchor crosshair
      </label>
    </section>
  );
};
