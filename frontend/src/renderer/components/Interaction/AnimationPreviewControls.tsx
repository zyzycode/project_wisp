export interface AnimationPreviewControlsProps {
  readonly bodyKeys: readonly string[];
  readonly faceKeys: readonly string[];
  readonly bodyKey: string | null;
  readonly faceKey: string | null;
  readonly loop: boolean;
  readonly onSelectBody: (key: string | null) => void;
  readonly onSelectFace: (key: string | null) => void;
  readonly onToggleLoop: () => void;
  readonly onReplay: () => void;
}

/** Exact manifest selection is a local Skin preview, never a behavior command. */
export function AnimationPreviewControls(props: AnimationPreviewControlsProps) {
  return (
    <section className="menu-section" aria-label="Просмотр анимаций">
      <div className="menu-section-title">Анимации и позы</div>
      <p>Выберите клип для просмотра на месте. Повторное нажатие запускает его с начала.</p>
      <div className="menu-btn-grid">
        <button type="button" className="menu-action-btn" onClick={props.onReplay} disabled={props.bodyKey === null}>
          С начала
        </button>
        <button type="button" className="menu-action-btn" onClick={() => props.onSelectBody(null)}>
          Сбросить просмотр
        </button>
        <button type="button" className="menu-action-btn" aria-pressed={props.loop} onClick={props.onToggleLoop}>
          Повтор: {props.loop ? 'ВКЛ' : 'ВЫКЛ'}
        </button>
      </div>
      <div role="status">{props.bodyKey ?? 'Просмотр не выбран'}</div>
      <div className="menu-anim-4col-grid">
        {props.bodyKeys.map(key => (
          <button key={key} type="button" className={`menu-anim-btn ${props.bodyKey === key ? 'active' : ''}`}
            aria-pressed={props.bodyKey === key} onClick={() => props.onSelectBody(key)}>{key}</button>
        ))}
      </div>
      <div className="menu-divider" />
      <div className="menu-section-title">Выражения лица</div>
      <div className="menu-anim-4col-grid">
        <button type="button" className="menu-anim-btn" aria-pressed={props.faceKey === null}
          onClick={() => props.onSelectFace(null)}>Без наложения</button>
        {props.faceKeys.map(key => (
          <button key={key} type="button" className={`menu-anim-btn ${props.faceKey === key ? 'active' : ''}`}
            aria-pressed={props.faceKey === key} onClick={() => props.onSelectFace(key)}>{key}</button>
        ))}
      </div>
    </section>
  );
}
