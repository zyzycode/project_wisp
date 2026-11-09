import { useRef, useState } from 'react';
import type { ScreenObservationRegion } from '../../../application/ports/screen-observation.interface';
import './screen-observation.css';
/** Geometry only. No pixels, thumbnails or native display identity are received here. */
export function ScreenRegionSelector() {
  const query = new URLSearchParams(window.location.search);
  const identity = { streamId: query.get('streamId') ?? '', conversationId: query.get('conversationId') ?? '' };
  const [region, setRegion] = useState<ScreenObservationRegion>({ left: .1, top: .1, width: .8, height: .8 });
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const origin = useRef<{ x: number; y: number } | null>(null);
  const command = async (type: 'region' | 'cancel') => {
    if (pending) return; setPending(true);
    try { await window.wispAPI?.screenObservation?.command(type === 'region' ? { ...identity, type, region } : { ...identity, type }); }
    catch { setError('Выбор завершён или недоступен. Вернитесь в чат и начните заново.'); }
    finally { setPending(false); }
  };
  const point = (event: React.PointerEvent) => ({ x: Math.max(0, Math.min(1, event.clientX / window.innerWidth)), y: Math.max(0, Math.min(1, event.clientY / window.innerHeight)) });
  return <main className="screen-selector" onKeyDown={event => { if (event.key === 'Escape') void command('cancel'); }}
    onPointerDown={event => { if (pending || event.button !== 0) return; origin.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { const first = origin.current; if (!first) return; const next = point(event); setRegion({ left: Math.min(first.x, next.x), top: Math.min(first.y, next.y), width: Math.abs(next.x - first.x), height: Math.abs(next.y - first.y) }); }}
    onPointerUp={() => { origin.current = null; }}>
    <div className="screen-selection-rect" style={{ left: `${region.left * 100}%`, top: `${region.top * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />
    <section className="screen-selector-controls" onPointerDown={event => event.stopPropagation()}>
      <h1>Выберите фрагмент экрана</h1><p>Проведите мышью или задайте область в процентах. Пока изображение не получено и не отправлено.</p>
      <div className="screen-region-fields">{(['left', 'top', 'width', 'height'] as const).map((key, i) => <label key={key}>{['Слева', 'Сверху', 'Ширина', 'Высота'][i]}<input type="number" min={0} max={100} step={1} value={Math.round(region[key] * 100)} onChange={event => { const value = Number(event.target.value) / 100; setRegion(previous => ({ ...previous, [key]: value })); }} /></label>)}</div>
      <div className="screen-actions"><button autoFocus type="button" disabled={pending || region.width <= 0 || region.height <= 0 || region.left + region.width > 1 || region.top + region.height > 1} onClick={() => { void command('region'); }}>Получить выбранный фрагмент</button><button type="button" disabled={pending} onClick={() => { void command('cancel'); }}>Отмена (Esc)</button></div>
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}
