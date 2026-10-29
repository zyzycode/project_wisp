import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { VoiceInputControls } from '../../src/renderer/components/Chat/VoiceInputControls';
const client = { enable: vi.fn(async () => undefined), disable: vi.fn() };
it('exposes voice mode outside the composer with no model download or record/stop actions', () => {
  const markup = renderToStaticMarkup(<VoiceInputControls client={client} state={{ enabled: false, phase: 'off', error: null }} available contextReady />);
  expect(markup).toContain('Включить микрофон');
  expect(markup).toContain('После паузы');
  expect(markup).not.toMatch(/Загрузить|Записать|Стоп/u);
  expect(markup).toContain('aria-pressed="false"');
});
it('always exposes off and announces paused state and errors', () => {
  const markup = renderToStaticMarkup(<VoiceInputControls client={client} state={{ enabled: true, phase: 'paused', error: 'Повторите фразу.' }} available contextReady />);
  expect(markup).toContain('Выключить микрофон');
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).toContain('Микрофон включён · пауза');
  expect(markup).toContain('role="alert"');
});
