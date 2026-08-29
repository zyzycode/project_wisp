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
  onSelect: (key: string | null) => void
): (event: React.ChangeEvent<HTMLSelectElement>) => void {
  return (event) => onSelect(normalizeInspectorSelection(event.currentTarget.value));
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
          aria-label="Body animation clip"
          className="debug-animation-select"
          value={selectedBodyKey ?? ''}
          onChange={createInspectorSelectionHandler(onSelectBody)}
        >
          <option value="">FSM / Auto</option>
          {bodyAnimationKeys.map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
      </label>

      <label>
        Face layer
        <select
          aria-label="Face animation layer"
          className="debug-animation-select"
          value={selectedFaceKey ?? ''}
          disabled={selectedBodyKey === null}
          onChange={createInspectorSelectionHandler(onSelectFace)}
        >
          <option value="">No forced face</option>
          {faceAnimationKeys.map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
      </label>

      <label className="debug-anchor-toggle">
        <input
          type="checkbox"
          checked={showAnchorPoint}
          onChange={onToggleAnchorPoint}
        />
        Show Anchor Point
      </label>
    </section>
  );
};
