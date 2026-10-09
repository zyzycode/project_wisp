import type { SpritePoint } from './types';

export interface PupilPoseTarget { setAttribute(name: string, value: string): void }
export interface PupilPoseHandle { setPupilOffset(offset: SpritePoint): void }

/** Only the reviewed pupil layer moves; no React tree or IPC update per gaze RAF. */
export class PupilPose implements PupilPoseHandle {
  private target: PupilPoseTarget | null = null;
  private transform = 'translate(0 0)';

  readonly attach = (target: PupilPoseTarget | null): void => {
    this.target = target;
    target?.setAttribute('transform', this.transform);
  };

  setPupilOffset(offset: SpritePoint): void {
    const clamp = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    const transform = `translate(${Math.round(clamp(offset.x) * 2000) / 1000} ${Math.round(clamp(offset.y) * 1000) / 1000})`;
    if (transform === this.transform) return;
    this.transform = transform;
    this.target?.setAttribute('transform', transform);
  }
}
