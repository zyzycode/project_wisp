# 70-cross-platform.md — Стандарты кроссплатформенной разработки

Правила обеспечения совместимости Project Wisp с Linux (Ubuntu), Windows и macOS.

---

## 1. Базовые принципы кроссплатформенности

1. **Нет Windows-only допущениям:** Проект разрабатывается с первого дня как кроссплатформенный продукт.
2. **Основная среда разработки — Ubuntu Linux:** Все скрипты сборки, пути и тесты обязаны безупречно работать в Linux-окружении.
3. **Изоляция платформозависимой логики:**
   - Никаких проверок `process.platform` в слоях Domain, Application или Renderer.
   - Все проверки операционной системы строго локализованы в `infrastructure/platform/`.

---

## 2. Паттерн «Интерфейс $\rightarrow$ Платформенный адаптер»

Для любой функции, зависящей от ОС:
1. Создаётся интерфейс в `application/ports/` (например, `IPlatformAdapter`, `IAutostartService`).
2. В `infrastructure/platform/` создаются реализации:
   - `LinuxPlatformAdapter`
   - `WindowsPlatformAdapter`
   - `MacOSPlatformAdapter`
3. Фабрика платформы `PlatformAdapterFactory.create()` инстанциирует нужный адаптер при старте Main-процесса.

```typescript
// infrastructure/platform/platform-adapter.factory.ts
export function createPlatformAdapter(): IPlatformAdapter {
  switch (process.platform) {
    case 'linux':
      return new LinuxPlatformAdapter();
    case 'darwin':
      return new MacOSPlatformAdapter();
    case 'win32':
      return new WindowsPlatformAdapter();
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
```

---

## 3. Специфика Linux (Ubuntu, X11 и Wayland)

1. **Детекция сессии дисплея:**
   - В Linux всегда учитывайте тип сессии (`process.env.XDG_SESSION_TYPE`).
2. **Прозрачность и Always-On-Top:**
   - В X11 прозрачность и `always-on-top` работают стабильно при наличии активного композитора (Mutter, Compton/Picom).
   - В Wayland прямое абсолютное позиционирование окон может быть ограничено политиками композитора. Используйте безопасные fallback-режимы и не блокируйте запуск приложения при невозможности установить точные координаты.
3. **Click-Through (`setIgnoreMouseEvents`):**
   - Передавайте `{ forward: true }` для прозрачного прокликивания, учитывая возможные различия обработки событий мыши.

---

## 4. Работа с путями и файловой системой

- **Запрещены жёстко закодированные разделители путей (`/` или `\`):** Всегда используйте `path.join()`, `path.resolve()` и `path.normalize()`.
- **Системные директории данных:**
  - Используйте стандартные методы Electron: `app.getPath('userData')`, `app.getPath('temp')`.
  - Запрещено напрямую формировать пути вроде `C:\\Users\\...` или предполагать фиксированную структуру `~/.config` без использования API платформы.
- **Чувствительность к регистру (Case Sensitivity):** В Linux файловая система чувствительна к регистру символов (`Case-Sensitive`). Все имена импортов и файлов должны в точности совпадать по регистру.

---

## 5. Автозапуск (Autostart)
- В Windows / macOS управление автозапуском выполняется через `app.setLoginItemSettings`.
- В Linux надежным методом является создание/удаление `.desktop`-файла в директории `~/.config/autostart/`. Адаптер `LinuxPlatformAdapter` инкапсулирует эту логику.
