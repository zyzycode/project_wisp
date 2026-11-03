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

## Ограниченный LIFE soak и синтетическая история

Обычный smoke после voice cleanup включает десять реальных секунд локальной автономности.
Для непрерывного пятиминутного прогона: `WISP_LIFE_SOAK_MS=300000 node scripts/wisp.mjs smoke:desktop /tmp/wisp-life-native`.
Параметр принимает только целое число 10000..300000 ms; deadline runner учитывает dwell.
Объём samples ограничен этой длительностью; флаг не меняет product runtime или AI-настройки.
`report.json.lifeSoak` сохраняет машину, фактическую длительность, начальные/конечные
Main RSS/heap, Electron process CPU/RAM, размеры SQLite/WAL/SHM, Main active-resource
и app/webContents listener counts, Main CPU time, p50/p95/max typed IPC ping и heartbeat gaps.
Это dev-профиль с mock AI и synthetic voice inference: ping — proxy отзывчивости,
не время Domain tick, а Node resource counts не покрывают все native/Chromium ресурсы.
PASS означает завершение измерения и успешные IPC ответы; численного общего бюджета
CPU/RAM/latency нет. Короткий soak не подтверждает многодневную native устойчивость.
Состояние новых планов, привычек и других ещё не реализованных зависимостей #196
проверяется после их отдельных implementation gates.

Ускоренные сценарии ядра запускаются отдельно из корня:

```sh
node scripts/wisp.mjs test:frontend tests/main/life-autonomy.test.ts tests/application/life-memory.test.ts --reporter=json --outputFile=/tmp/wisp-life.json
```

В JSON metadata тестов: `life` — семь simulated days с управляемыми clock/RNG,
bounded cadence/trace, stale/duplicate callback и stall decay; `lifeMemory` — семь
simulated days, 1008 synthetic dialogue pairs и game episodes, их exact replay,
реальные SQLite worker crash/restart/reset и bounded recall. Измерения CPU/RSS
Vitest включают тестовый процесс и worker; сравнивать их с Electron RSS нельзя.
DB retention до reset разрешает рост истории: общего disk cap нет по
[Memory Engine](engine/MEMORY_ENGINE.md), поэтому рост файла сам по себе не утечка.
Ни эти тесты, ни smoke не читают product DB и не вызывают платных провайдеров.

## Платформы и CI

Workflow `desktop-smoke.yml` запускает Windows/macOS runners и Linux в Xvfb/Openbox. Linux-результат помечен `virtualDisplay: true`: это реальный Electron в виртуальном X11, не доказательство работы Wayland или физического композитора. Недоступность desktop session на runner не превращается в PASS. Артефакты сохраняются и после ошибки.

На временном Linux CI runner workflow сначала материализует загружаемый Electron binary, затем настраивает поставляемый `chrome-sandbox` как root:root с mode 4755 и проверяет права. Это требуется SUID sandbox при ограниченных user namespaces; sandbox, AppArmor и системные ограничения не отключаются. Первый CI-прогон #147 обнаружил именно ненастроенный helper, поэтому эта подготовка выполняется до запуска Electron.

Для native Linux запустить из графической X11 или Wayland-сессии. Для Wayland отдельно зафиксировать фактически использованный Electron backend (Wayland/XWayland); переменная XDG_SESSION_TYPE сама по себе его не доказывает. Windows/macOS запускать из пользовательского графического сеанса. Эта задача не вводит новую tray-функцию и не исправляет известные дефекты опор #97/#130.

Ручная запись: commit, OS/version/session, Electron, monitor/DPI, сценарий, ожидаемый/фактический результат, PASS/FAIL/NOT RUN с причиной. Windows MVP: [чеклист](WINDOWS_MVP_CHECKLIST.md). Разовые #43/#51/#60 сохраняют собственный scope и не закрываются зелёным smoke.

## Проверка самого runner

```sh
node --test scripts/tests/smoke.test.mjs
node scripts/wisp.mjs test:tooling
```

Тесты проверяют отказ без quit receipt, nonzero exit, очистку timed-out процесса, abort до следующего шага и отсутствие унаследованных AI credentials/debug bypass. На POSIX дополнительно посылается настоящий SIGTERM во время dev-компиляции прямому runner и корневому launcher: оба сохраняют failure report, не запускают Electron и возвращают 1. Windows taskkill принудительно завершает дерево: interrupted-команда возвращает 1, но финальный report при таком завершении не гарантирован (CI сохраняет уже созданные артефакты). Ошибки сборки, запуска и runtime не скрываются; при проблеме Linux sandbox исправить окружение, не добавлять `--no-sandbox`.
