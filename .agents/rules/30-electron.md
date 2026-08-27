# 30-electron.md — Стандарты разработки и безопасности Electron

Безопасность архитектуры Electron и кроссплатформенная изоляция имеют абсолютный приоритет над удобством разработки.

---

## 1. Базовые настройки безопасности BrowserWindow

При создании любых окон (`BrowserWindow`) обязательны следующие флаги `webPreferences`:

```typescript
const win = new BrowserWindow({
  // ... параметры окна
  webPreferences: {
    nodeIntegration: false,          // КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО включать
    nodeIntegrationInWorker: false,
    contextIsolation: true,          // ОБЯЗАТЕЛЬНО включено
    sandbox: true,                   // Включено для изоляции процесса рендера
    webSecurity: true,               // Защита от опасных кросс-доменных запросов
    allowRunningInsecureContent: false,
    preload: path.join(__dirname, 'preload.js'),
  },
});
```

---

## 2. Кроссплатформенное управление окнами (Window Management)
- Создание и настройка свойств окон (`transparent`, `alwaysOnTop`, `setIgnoreMouseEvents`, `skipTaskbar`) производятся через платформенные адаптеры `infrastructure/platform/`.
- **Linux (X11 / Wayland):**
  - Обязательно проверять поддержку прозрачности и композитинга.
  - При `setIgnoreMouseEvents` использовать `{ forward: true }`.
  - В Wayland избегать жесткой зависимости от абсолютных экранных координат окна.
- **Windows / macOS:**
  - Использовать платформозависимые уровни `alwaysOnTop` (`screen-saver` на Windows, `floating` на macOS).

---

## 3. Изоляция через Preload (Zero Raw IPC Leak)
- **Категорически запрещено** экспортировать `ipcRenderer` или общие методы `.send()` / `.on()` в глобальный объект `window`.
- Preload-скрипт обязан объявлять точечные типизированные методы:

```typescript
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import { PetPosition, SendMessagePayload } from '../shared/ipc-contracts';

contextBridge.exposeInMainWorld('wispAPI', {
  sendUserMessage: (payload: SendMessagePayload): Promise<void> =>
    ipcRenderer.invoke('chat:send-message', payload),

  onCharacterStateChanged: (callback: (state: unknown) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value);
    ipcRenderer.on('character:state-changed', subscription);
    return () => ipcRenderer.removeListener('character:state-changed', subscription);
  },

  updatePosition: (pos: PetPosition): Promise<void> =>
    ipcRenderer.invoke('window:set-position', pos),
});
```

---

## 4. Защита файловой системы и системных вызовов
- Renderer не имеет доступа к Node.js `fs`, `path`, `os`, `child_process`.
- Любая работа с файлами (сохранение настроек, чтение спрайтов) происходит исключительно в Main-процессе через проверенные пути на базе `app.getPath('userData')`.
- Категорически запрещено выполнять произвольные shell-команды (`child_process.exec`, `execSync`).
- Открытие внешних ссылок (`shell.openExternal`) разрешено только после валидации протокола (`url.startsWith('https://')`).

---

## 5. Защита от перехвата навигации
- Все окна должны блокировать несанкционированную навигацию и открытие новых окон:
```typescript
win.webContents.setWindowOpenHandler(({ url }) => {
  if (url.startsWith('https://')) {
    shell.openExternal(url);
  }
  return { action: 'deny' };
});

win.webContents.on('will-navigate', (event, navigationUrl) => {
  const parsedUrl = new URL(navigationUrl);
  if (parsedUrl.origin !== 'app://wisp' && !navigationUrl.startsWith('file://')) {
    event.preventDefault();
  }
});
```

---

## 6. Хранение секретов и конфиденциальных данных
- Project Wisp не должен требовать пользовательских API-ключей, backend-токенов или идентификаторов облачной сессии.
- Локальные чувствительные данные (например, приватные настройки пользователя или будущие локальные ключи шифрования памяти) никогда не передаются и не хранятся в DOM, `localStorage` или Zustand сторах Renderer-процесса.
- Все чувствительные данные остаются в памяти Main-процесса или защищённом системном хранилище (`safeStorage`), если такая защита действительно требуется текущей задачей.
