import React from 'react';
import type { Needs } from '../../../domain/character/types';

export interface NeedsIndicatorProps {
  needs: Needs;
}

const NEEDS: readonly { readonly key: keyof Needs; readonly label: string; readonly icon: string }[] = [
  { key: 'energy', label: 'Energy', icon: '⚡' },
  { key: 'attention', label: 'Attention', icon: '👁' },
  { key: 'play', label: 'Play', icon: '🎲' },
  { key: 'comfort', label: 'Comfort', icon: '☁' },
];

export const NeedsIndicator: React.FC<NeedsIndicatorProps> = ({ needs }) => (
  <section aria-label="Needs">
    <div className="debug-hud-section-title">Needs</div>
    {NEEDS.map(({ key, label, icon }) => {
      const value = clampPercentage(needs[key]);
      return (
        <div className="debug-need" key={key}>
          <span>{icon} {label}</span>
          <span>{Math.round(value)}</span>
          <div className="debug-need-track" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
            <div className="debug-need-fill" style={{ width: `${value}%` }} />
          </div>
        </div>
      );
    })}
  </section>
);

function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value));
}
