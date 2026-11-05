import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ObservationTimingControls, TIMING_DISCLOSURE } from '../../src/renderer/components/Interaction/ObservationSettings';
import type { ObservationSettingsDTO } from '../../src/shared/observation-contracts';
const state: ObservationSettingsDTO = { generation: 1, enabled: true, paused: false, status: 'available', reason: null,
  timingEnabled: false, timingStatus: 'off', applications: [], previewOpen: false, preview: null };
it.each(['off', 'settling', 'stable', 'unavailable'] as const)('renders%s as a separate explicit permission without inference or raw metadata', timingStatus => {
  const onToggle = vi.fn();
  const html = renderToStaticMarkup(<ObservationTimingControls state={{ ...state, timingStatus, timingEnabled: timingStatus !== 'off' }} onToggle={onToggle} />);
  expect(html).toContain(TIMING_DISCLOSURE); expect(html).toContain('Учитывать переключение окон при выборе момента приглашения');
  expect(html).toContain('aria-describedby='); expect(html).toContain('role="status"');
  expect(html).not.toMatch(/appKey|episodeToken|sourceToken|windowTitle/u); expect(onToggle).not.toHaveBeenCalled();
});
it('does not offer enabling without the original source consent, and always allows revocation', () => {
  const render = (timingEnabled: boolean) => renderToStaticMarkup(<ObservationTimingControls state={{ ...state, enabled: false, status: 'off', reason: 'disabled', timingEnabled, timingStatus: timingEnabled ? 'unavailable' : 'off' }} onToggle={() => {}} />);
  expect(render(false)).toContain('disabled=""');
  expect(render(true)).not.toContain('disabled=""'); expect(render(true)).toContain('checked=""');
});
