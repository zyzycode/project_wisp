# Desktop smoke

Из корня с установленными frontend dependencies и Node 24:

```sh
node scripts/wisp.mjs smoke:desktop /absolute/path/to/report
```

Без аргумента результат сохраняется в новом каталоге системного temp; путь печатается в конце. Относительный путь считается от `frontend/` (npm cwd). Запуск требует доступной desktop session. Linux без DISPLAY/WAYLAND_DISPLAY завершится с кодом 1 и NOT RUN для desktop session.

Runner использует Vite dev server и одноразовую dev-компиляцию Main/preload существующим vite-plugin-electron. Это не packaged build; `npm run build` не вызывается. Main, preload и Renderer настоящие, production-код не содержит smoke hooks. Временный userData изолирован от личного профиля и удаляется после проверки. AI-настройки/ключи не наследуются, backend не запускается, используется mock; Renderer session ограничена localhost dev server. Sandbox остаётся включённым.

## Что подтверждает результат

| Проверка | Автоматический результат | Ручное дополнение |
|---|---|---|
| Запуск | Видимое окно, DOM персонажа, preload, bridge, отсутствие runtime errors | Проверить внешний вид |
| Прозрачность | Прозрачный CSS body | Видимость рабочего стола через пустые пиксели, click-through |
| Меню | Electron injected right-click открывает меню | Физический клик/доступность на конкретной ОС |
| Drag/release | DOM pointer → React → IPC → Main меняет позицию и завершает drag | Захват настоящего указателя, выход за окно, отпускание |
| DPI | Валидные screen bounds и scaleFactor, capturePage | Масштаб 100/150/200%, Retina, переход между мониторами |
| Tray | NOT RUN: tray в текущей реализации отсутствует | Проверить после появления capability |
| Завершение | UI bridge вызывает штатный quit, получен will-quit и exit 0 | Проверить отсутствие оставшихся процессов в диспетчере ОС |

`report.json` содержит commit, OS/session, Electron, дисплеи и отдельные PASS/FAIL/NOT RUN. `electron.log` ограничен 32 KiB; `window.png` — только окно Wisp с временным mock-профилем. Нет снимка всего рабочего стола. Любая обязательная ошибка, timeout, прерывание или ошибка cleanup даёт ненулевой exit code; непроверенные ручные пункты остаются NOT RUN даже при коде 0.

## Платформы и CI

Workflow `desktop-smoke.yml` запускает Windows/macOS runners и Linux в Xvfb/Openbox. Linux-результат помечен `virtualDisplay: true`: это реальный Electron в виртуальном X11, не доказательство работы Wayland или физического композитора. Недоступность desktop session на runner не превращается в PASS. Артефакты сохраняются и после ошибки.

Для native Linux запустить из графической X11 или Wayland-сессии. Для Wayland отдельно зафиксировать фактически использованный Electron backend (Wayland/XWayland); переменная XDG_SESSION_TYPE сама по себе его не доказывает. Windows/macOS запускать из пользовательского графического сеанса. Эта задача не вводит новую tray-функцию и не исправляет известные дефекты опор #97/#130.

Ручная запись: commit, OS/version/session, Electron, monitor/DPI, сценарий, ожидаемый/фактический результат, PASS/FAIL/NOT RUN с причиной. Windows MVP: [чеклист](WINDOWS_MVP_CHECKLIST.md). Разовые #43/#51/#60 сохраняют собственный scope и не закрываются зелёным smoke.

## Проверка самого runner

```sh
node --test scripts/tests/smoke.test.mjs
node scripts/wisp.mjs test:tooling
```

Тесты проверяют отказ без quit receipt, nonzero exit, очистку timed-out процесса, abort до следующего шага и отсутствие унаследованных AI credentials/debug bypass. На POSIX дополнительно посылается настоящий SIGTERM во время dev-компиляции прямому runner и корневому launcher: оба сохраняют failure report, не запускают Electron и возвращают 1. Windows taskkill принудительно завершает дерево: interrupted-команда возвращает 1, но финальный report при таком завершении не гарантирован (CI сохраняет уже созданные артефакты). Ошибки сборки, запуска и runtime не скрываются; при проблеме Linux sandbox исправить окружение, не добавлять `--no-sandbox`.
