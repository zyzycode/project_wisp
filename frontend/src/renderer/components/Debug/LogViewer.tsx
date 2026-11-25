import React, { useEffect, useRef, useState } from 'react';
import type { DebugLogEntryDTO } from '../../../shared/ipc-contracts';

export interface LogViewerProps {
  logs: readonly DebugLogEntryDTO[];
  onClear: () => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, onClear }) => {
  const [pausedLogs, setPausedLogs] = useState<readonly DebugLogEntryDTO[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const paused = pausedLogs !== null;
  const visibleLogs = pausedLogs ?? logs;

  useEffect(() => {
    if (!paused && followLatest.current && listRef.current !== null) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [paused, visibleLogs]);

  return (
    <section className="debug-log-viewer" aria-label="Журнал приложения">
      <div className="debug-log-header">
        <h3 className="menu-settings-heading">Журнал приложения</h3>
        <div className="debug-log-controls">
          <button
            type="button"
            onClick={() => {
              if (paused) {
                followLatest.current = true;
                setPausedLogs(null);
              } else {
                setPausedLogs(logs);
              }
            }}
          >
            {paused ? 'Продолжить' : 'Пауза'}
          </button>
          <button type="button" onClick={() => {
            if (paused) setPausedLogs([]);
            onClear();
          }}>Очистить</button>
        </div>
      </div>
      <div className="debug-log-list" ref={listRef} role="log" aria-label="Записи журнала" tabIndex={0}
        aria-live={paused ? 'off' : 'polite'} onScroll={event => {
          const list = event.currentTarget;
          followLatest.current = list.scrollHeight - list.clientHeight - list.scrollTop <= 2;
        }}>
        {visibleLogs.length === 0 ? <div className="debug-log-empty">Записей пока нет.</div> : visibleLogs.map((entry) => (
          <div className={`debug-log-entry debug-log-${entry.level}`} key={entry.id}>
            <time dateTime={entry.createdAt} title={entry.createdAt}>{entry.createdAt.slice(11, 19)} UTC</time>
            {' '}<span>{entry.level}</span> <span>{entry.context}</span> {entry.message}
          </div>
        ))}
      </div>
    </section>
  );
};
