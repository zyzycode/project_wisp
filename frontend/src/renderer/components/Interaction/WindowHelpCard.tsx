import { useEffect, useRef, useState } from 'react';
import type { IWindowHelpControls, WindowHelpRegion, WindowHelpStatusDTO } from '../../../application/ports/window-help.interface';
interface Props { readonly status: WindowHelpStatusDTO; readonly streamId: string; readonly bridge?: IWindowHelpControls }
const REGIONS: Record<WindowHelpRegion, string> = {
  upper_left: 'вверху слева', upper_center: 'вверху по центру', upper_right: 'вверху справа',
  middle_left: 'слева по центру', middle_center: 'в центре', middle_right: 'справа по центру',
  lower_left: 'внизу слева', lower_center: 'внизу по центру', lower_right: 'внизу справа',
};
const OUTCOMES = { fulfilled: 'Wisp добралась до окна.', declined: 'Просьба закрыта.',
  unanswered: 'Время просьбы истекло.', cancelled: 'Просьба отменена.', target_lost: 'Окно больше недоступно.' } as const;
export function WindowHelpCard({ status, streamId, bridge }: Props) {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0);
  const requestId = status.phase === 'none' ? null : status.requestId;
  useEffect(() => { epoch.current++; setPending(false); setError(''); return () => { epoch.current++; }; }, [streamId, requestId]);
  if (status.phase === 'closed') return <section className="window-help-card" aria-label="Помощь Wisp с окном">
    <p role="status">{OUTCOMES[status.outcome]}</p>
  </section>;
  if (status.phase !== 'waiting' && status.phase !== 'assisting') return null;
  const target = status.target;
  const decline = async (): Promise<void> => {
    if (!bridge || pending) return;
    const current = epoch.current;
    setPending(true); setError('');
    try {
      const result = await bridge.decline({ streamId, requestId: status.requestId });
      if (current === epoch.current && !result.ok) setError('Просьба уже завершилась.');
    } catch { if (current === epoch.current) setError('Не удалось закрыть просьбу. Попробуйте снова.'); }
    finally { if (current === epoch.current) setPending(false); }
  };
  return <section className="window-help-card" aria-label="Помощь Wisp с окном">
    <p>{status.phase === 'assisting' ? 'Перенесите Wisp на верхнюю грань отмеченного окна.'
      : 'Можно перетащить Wisp на верхнюю грань окна, отмеченного на схеме.'}</p>
    <svg viewBox="0 0 100 100" width="100" height="100" role="img" aria-label={`Нужное окно ${REGIONS[target.region]}`}>
      <rect x="1" y="1" width="98" height="98" fill="none" stroke="currentColor" />
      <rect x={target.left * 100} y={target.top * 100} width={target.width * 100}
        height={target.height * 100} fill="currentColor" fillOpacity="0.15" stroke="currentColor" />
    </svg>
    <p>Окно {REGIONS[target.region]}. Wisp не перемещает окна и не управляет компьютером.</p>
    <button type="button" disabled={!bridge || pending} onClick={() => { void decline(); }}>Не сейчас</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
