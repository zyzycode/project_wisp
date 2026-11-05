import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WindowHelpCard } from '../../src/renderer/components/Interaction/WindowHelpCard';
it('renders a keyboard-focusable decline and geometry-only accessible manual target', () => {
  const html = renderToStaticMarkup(<WindowHelpCard streamId="s" bridge={{ decline: async () => ({ ok: true }) }} status={{
    phase: 'waiting', requestId: 'r', expiresAtMs: 60000,
    target: { region: 'upper_center', left: .2, top: .1, width: .4, height: .4 },
  }} />);
  expect(html).toContain('type="button"'); expect(html).toContain('Не сейчас');
  expect(html).toContain('aria-label="Нужное окно вверху по центру"');
  expect(html).toContain('верхнюю грань'); expect(html).not.toContain('<img');
  expect(renderToStaticMarkup(<WindowHelpCard streamId="s" status={{ phase: 'closed', requestId: 'r', outcome: 'cancelled' }} />)).toContain('Просьба отменена.');
});
