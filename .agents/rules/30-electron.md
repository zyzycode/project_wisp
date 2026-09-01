# Electron и IPC

## BrowserWindow

- Для Renderer обязательны `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` и `allowRunningInsecureContent: false`.
- Preload задаётся явно; удалённый контент не получает привилегированный preload.
- Новые окна и непредусмотренную навигацию блокируй через `setWindowOpenHandler` и `will-navigate`.
- Внешний URL разбирай через `URL` и проверяй допустимые protocol/host до `shell.openExternal`.

## Preload и IPC

- Не экспортируй `ipcRenderer`, общие `send/on/invoke` или произвольное имя channel.
- `window.wispAPI` содержит только точечные типизированные методы конкретных use cases.
- Валидируй channel, sender и payload в Main до вызова use case; ответ тоже должен соответствовать serializable DTO.
- Подписка из preload возвращает функцию удаления точного listener; Renderer вызывает её в cleanup.
- IPC handler не содержит domain rules: он валидирует, вызывает Application и переводит ошибку в безопасный контракт.

## Системный доступ

- `fs`, `path`, `os`, SQLite, `safeStorage`, shell и управление окнами доступны только из Main/Infrastructure.
- Пользовательские файлы и данные размещай через Electron paths, прежде всего `app.getPath('userData')`.
- Не выполняй произвольные shell-команды и не передавай чувствительные данные в DOM, `localStorage` или Renderer store.
- Window behavior, click-through, tray и autostart реализуются через platform adapters.
