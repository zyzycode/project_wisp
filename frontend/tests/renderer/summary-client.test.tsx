import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { getSummaryClient, SummaryClient } from '../../src/renderer/summary-client';
import { SummaryControls } from '../../src/renderer/components/Chat/SummaryControls';
import type { SummaryApiBridge, SummaryResultDTO, SummaryPreviewDTO } from '../../src/shared/ipc-contracts';
const preview: SummaryPreviewDTO = { previewId: 'p', expiresAt: 120000, pairs: Array.from({ length: 4 }, () => ({ userText: 'u', assistantText: 'a' })) };
function fixture() {
  const bridge = { preview: vi.fn<SummaryApiBridge['preview']>(async () => ({ ok: true, value: preview })), confirm: vi.fn<SummaryApiBridge['confirm']>(async () => ({ ok: true, value: 'summary' })), deleteSummary: vi.fn<SummaryApiBridge['deleteSummary']>(async () => ({ ok: true, value: null })) };
  const client = new SummaryClient(bridge, () => 'command'); client.acceptIdentity('s', 'c'); return { bridge, client };
}
it('renders explicit entry without preview or inference on mount', () => {
  const { bridge } = fixture();
  const markup = renderToStaticMarkup(<SummaryControls bridge={bridge} snapshot={{ streamId: 's', dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } } }} />);
  expect(markup).toContain('Составить краткое содержание'); expect(markup).toContain('Удалить краткое содержание');
  expect(bridge.preview).not.toHaveBeenCalled(); expect(bridge.confirm).not.toHaveBeenCalled();
});
it('requires preview and explicit confirm and reuses the same command after uncertain delivery', async () => {
  const { bridge, client } = fixture(); await client.confirm(); expect(bridge.confirm).not.toHaveBeenCalled();
  await client.preview(); expect(client.getState().preview?.pairs).toEqual(preview.pairs); expect(bridge.confirm).not.toHaveBeenCalled();
  bridge.confirm.mockRejectedValueOnce(new Error('offline')); await client.confirm(); expect(client.getState().retry).toBe(true);
  await client.confirm(); expect(bridge.confirm.mock.calls[0]).toEqual(bridge.confirm.mock.calls[1]); expect(client.getState().text).toBe('summary');
  await client.deleteSummary(); expect(client.getState().text).toBeNull();
});
it('drops previews and late completion on dialogue reset or stream replacement', async () => {
  const { bridge, client } = fixture(); let resolve!: (result: SummaryResultDTO<SummaryPreviewDTO>) => void;
  bridge.preview.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const pending = client.preview(); client.acceptIdentity('s', 'new-conversation'); resolve({ ok: true, value: preview }); await pending;
  expect(client.getState().preview).toBeNull(); await client.confirm(); expect(bridge.confirm).not.toHaveBeenCalled();
});

it('shows exact selected pairs and separate transmission consent before generation', async () => {
  const { bridge } = fixture();
  const client = getSummaryClient(bridge); client.acceptIdentity('s', 'c');
  bridge.preview.mockResolvedValueOnce({ ok: true, value: { ...preview, pairs: preview.pairs.map((pair, i) => ({ ...pair, userText: `Source ${i} <script>`, assistantText: `Reply ${i}` })) } });
  await client.preview();
  const markup = renderToStaticMarkup(<SummaryControls bridge={bridge} snapshot={{ streamId: 's', dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } } }} />);
  expect(markup).toContain('Source 0 &lt;script&gt;'); expect(markup).toContain('Reply 3');
  expect(markup).toContain('Подтверждаю отправку этих пар'); expect(markup).toContain('внешнему AI-провайдеру'); expect(markup).toContain('24 часа');
  expect(bridge.confirm).not.toHaveBeenCalled();
});
