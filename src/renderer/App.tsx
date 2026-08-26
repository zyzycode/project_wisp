import React, { useEffect, useState } from 'react';
import type { SystemInfoDTO } from '../shared/ipc-contracts';

export const App: React.FC = () => {
  const [systemInfo, setSystemInfo] = useState<SystemInfoDTO | null>(null);
  const [pingStatus, setPingStatus] = useState<string>('Не отправлено');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (window.wispAPI?.getSystemInfo) {
      window.wispAPI
        .getSystemInfo()
        .then((info) => setSystemInfo(info))
        .catch((err) => console.error('Failed to get system info:', err));
    }
  }, []);

  const handlePing = async () => {
    if (!window.wispAPI?.ping) {
      setPingStatus('wispAPI недоступен (запуск в чистом браузере)');
      return;
    }
    try {
      setLoading(true);
      const res = await window.wispAPI.ping('Hello from React Renderer!');
      setPingStatus(`${res.reply} (${new Date(res.timestamp).toLocaleTimeString()})`);
    } catch (err) {
      setPingStatus(`Ошибка: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>✨ Project Wisp — Electron Shell</h1>
      <p style={{ color: '#aaa' }}>
        Фаза 1: Базовый кроссплатформенный каркас с типизированным IPC и строгой изоляцией процессов.
      </p>

      <div className="card">
        <h3>Системная среда</h3>
        {systemInfo ? (
          <div className="system-info">
            <div className="system-info-item">
              <span className="label">Платформа ОС</span>
              <span className="value">{systemInfo.platform}</span>
            </div>
            <div className="system-info-item">
              <span className="label">Electron</span>
              <span className="value">v{systemInfo.electronVersion}</span>
            </div>
            <div className="system-info-item">
              <span className="label">Chromium</span>
              <span className="value">v{systemInfo.chromeVersion}</span>
            </div>
            <div className="system-info-item">
              <span className="label">Node.js</span>
              <span className="value">v{systemInfo.nodeVersion}</span>
            </div>
          </div>
        ) : (
          <p style={{ color: '#888' }}>Загрузка системной информации через IPC...</p>
        )}

        <div style={{ marginTop: '1.5rem' }}>
          <button onClick={handlePing} disabled={loading}>
            {loading ? 'Отправка...' : '📡 Проверить Typed IPC (Ping)'}
          </button>
        </div>

        {pingStatus && (
          <div className="ping-result">
            <strong>Ответ IPC:</strong> {pingStatus}
          </div>
        )}
      </div>
    </div>
  );
};
