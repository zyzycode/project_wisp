import { expect, it } from 'vitest';
import { parseObservationCommand, parseObservationSettings } from '../../src/shared/observation-ipc-validation';
const settings = { generation: 1, enabled: true, paused: false, status: 'available', reason: null,
  timingEnabled: true, timingStatus: 'settling', applications: [], previewOpen: false, preview: null };
it('accepts only exact timing commands and normalized settings, never Renderer source metadata', () => {
  for (const type of ['timing-enable', 'timing-disable']) {
    expect(parseObservationCommand({ type, streamId: 's', generation: 1 })).toEqual({ type, streamId: 's', generation: 1 });
    for (const extra of [{ appKey: 'x' }, { windowTitle: 'secret' }, { capturedAtMs: 1 }, { enabled: true }]) expect(() => parseObservationCommand({ type, streamId: 's', generation: 1, ...extra })).toThrow();
  }
  expect(parseObservationSettings(settings)).toEqual(settings);
  for (const patch of [{ timingEnabled: 'true' }, { timingStatus: 'busy' }, { timingEnabled: false }, { enabled: false }, { paused: true }, { windowTitle: 'secret' }]) expect(() => parseObservationSettings({ ...settings, ...patch })).toThrow();
});
