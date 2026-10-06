import React, { useEffect, useRef, useState } from 'react';
import type { DebugLogEntryDTO } from '../../../shared/ipc-contracts';

export interface LogViewerProps {
  logs: readonly DebugLogEntryDTO[];
  onClear: () => void;
}

const MAX_VISIBLE_LOGS = 20;

export const LogViewer: React.FC<LogViewerProps> = ({ logs, onClear }) => {
  const [paused, setPaused] = useState(false);
  const [pausedLogs, setPausedLogs] = useState<readonly DebugLogEntryDTO[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visibleLogs = getVisibleLogs(logs, paused, pausedLogs);

  useEffect(() => {
    if (!paused && listRef.current !== null) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [paused, visibleLogs]);

  return (
    <section className="debug-log-viewer" aria-label="Live logs">
      <div className="debug-log-header">
        <div className="debug-hud-section-title">Live logs</div>
        <div className="debug-log-controls">
          <button
            type="button"
            onClick={() => {
              if (paused) {
                setPaused(false);
                setPausedLogs(null);
              } else {
                setPausedLogs(logs);
                setPaused(true);
              }
            }}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" onClick={onClear}>Clear</button>
        </div>
      </div>
      <div className="debug-log-list" ref={listRef} aria-live={paused ? 'off' : 'polite'}>
        {visibleLogs.length === 0 ? <div className="debug-log-empty">No logs yet</div> : visibleLogs.map((entry) => (
          <div className={`debug-log-entry debug-log-${entry.level}`} key={entry.id}>
            <span>{entry.level}</span> <span>{entry.context}</span> {entry.message}
          </div>
        ))}
      </div>
    </section>
  );
};

export function getVisibleLogs(
  logs: readonly DebugLogEntryDTO[],
  paused: boolean,
  pausedLogs: readonly DebugLogEntryDTO[] | null
): readonly DebugLogEntryDTO[] {
  return (paused ? pausedLogs ?? logs : logs).slice(-MAX_VISIBLE_LOGS);
}
