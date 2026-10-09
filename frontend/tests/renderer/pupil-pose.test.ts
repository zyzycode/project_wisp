import { expect, it, vi } from 'vitest';
import { PupilPose } from '../../src/renderer/render-engine/pupil-pose';

it('applies fractional offsets within the reviewed eye aperture and survives layer replacement', () => {
  const pose = new PupilPose();
  const first = { setAttribute: vi.fn() }, second = { setAttribute: vi.fn() };
  pose.attach(first);
  pose.setPupilOffset({ x: 0.25, y: -0.3 });
  expect(first.setAttribute).toHaveBeenLastCalledWith('transform', 'translate(0.5 -0.3)');
  pose.attach(null); pose.attach(second);
  expect(second.setAttribute).toHaveBeenLastCalledWith('transform', 'translate(0.5 -0.3)');
  pose.setPupilOffset({ x: 5, y: -5 });
  expect(second.setAttribute).toHaveBeenLastCalledWith('transform', 'translate(2 -1)');
  pose.setPupilOffset({ x: NaN, y: Infinity });
  expect(second.setAttribute).toHaveBeenLastCalledWith('transform', 'translate(0 0)');
});

it('does not write DOM or retain a history during eight hours of settled gaze frames', () => {
  const pose = new PupilPose(), setAttribute = vi.fn();
  pose.attach({ setAttribute });
  for (let frame = 0; frame < 8 * 60 * 60 * 60; frame++) pose.setPupilOffset({ x: 0.5, y: 0.25 });
  expect(setAttribute).toHaveBeenCalledTimes(2);
});
