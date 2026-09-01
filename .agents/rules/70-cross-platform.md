# Кроссплатформенность

- Поддерживаемые платформы: Linux, Windows и macOS; базовая среда разработки — Ubuntu Linux.
- Domain, Application и Renderer не проверяют `process.platform`; выбор реализации происходит один раз в Main/Infrastructure.
- OS capability объявляется application port и реализуется platform adapter. Не разбрасывай platform branches по feature-коду.
- Используй `path.join/resolve/normalize` и Electron `app.getPath(...)`; не собирай системные пути строками.
- Регистр import path должен точно совпадать с именем файла на диске.
- Скрипты разработки не должны молча предполагать Bash, GNU utilities, drive letters или фиксированный home path.

## Окна и desktop integration

- Linux должен иметь явные fallbacks для X11/Wayland, прозрачности, absolute positioning и compositor limitations.
- Click-through и forwarding событий проверяй отдельно на каждой платформе; не считай поведение Electron идентичным.
- Уровни always-on-top, tray, notifications и autostart инкапсулируй в adapter и применяй только поддерживаемые capabilities.
- Неподдерживаемая возможность должна давать безопасный fallback, а не блокировать запуск приложения.

При изменении platform adapter проверь нейтральный контракт, целевую реализацию и fallback хотя бы unit/integration тестами; platform smoke test укажи отдельно, если он доступен.
