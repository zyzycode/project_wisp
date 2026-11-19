# Диагностика desktop

Диагностика использует существующий `AppLogger`. Политика читается при запуске процесса
и одинакова для dev и packaged приложения; после изменения нужен перезапуск.
Переключатель не зависит от dev-only debug UI и не включает AI-запросы, микрофон
или наблюдение экрана.

| Переменная | Значения | По умолчанию |
|---|---|---|
| `WISP_DESKTOP_LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `silent` | `warn` |
| `WISP_LOG_LEVEL` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`, `OFF` | `WARNING` |

Значения чувствительны к регистру. Неизвестное значение desktop/передаваемого backend
уровня заменяется безопасным default; возможно одно статическое предупреждение
`logging_configuration_invalid` без исходного значения. Для прямого запуска backend
действуют его собственные [правила валидации](../../backend/docs/LOGGING.md).

`warn` оставляет редкие сбои; `info` добавляет запуск, завершение и итог подключения AI;
`debug` также разрешает статическую запись инициализации desktop-сервисов.
`silent` выключает desktop-вывод и пополнение существующего RAM-буфера (до 100 записей).
Это не отдельный log viewer: существующая debug telemetry показывает только разрешённые
desktop-записи и доступна по прежним правилам debug UI.

## Запуск

Из корня репозитория в bash:

```bash
WISP_DESKTOP_LOG_LEVEL=debug WISP_LOG_LEVEL=WARNING node scripts/wisp.mjs dev
```

В PowerShell:

```powershell
$env:WISP_DESKTOP_LOG_LEVEL = 'debug'
$env:WISP_LOG_LEVEL = 'WARNING'
node scripts/wisp.mjs dev
```

Для выключения обоих потоков задайте `WISP_DESKTOP_LOG_LEVEL=silent` и
`WISP_LOG_LEVEL=OFF`, затем перезапустите Wisp. У packaged приложения задайте те же
переменные в окружении запускающего процесса и запустите исполняемый файл из этого
окружения. Изменение окружения уже работающего приложения не меняет его политику.

Вывод — JSON lines в stderr запускающего desktop-процесса, с локальной UTC timestamp.
Наличие подключённого stderr зависит от способа запуска: Windows GUI без консоли
не обещает видимых сообщений. Приложение не создаёт log-файлы и не предоставляет
экспорт, ротацию или отправку логов. Если оператор перенаправляет stderr средствами
своего shell/process launcher, хранение и удаление полученной копии находятся вне Wisp.
Native packaged отображение/перенаправление отдельно проверяется на целевой ОС;
unit tests не подтверждают его.

## Managed backend

Уровни независимы: `WISP_DESKTOP_LOG_LEVEL=silent` вместе с `WISP_LOG_LEVEL=DEBUG`
позволяет читать диагностику backend без desktop-событий. Main передаёт managed child
только проверенный `WISP_LOG_LEVEL`; формат backend принудительно JSON. Format/module
overrides, dotenv и provider environment не наследуются. Standalone backend сохраняет
собственные format/module overrides. Dev Uvicorn запускается с `--no-access-log`;
его безопасная request diagnostics остаётся у backend.

Main не пересылает raw stderr: принимает только [согласованные события и поля](../../docs/contracts/BACKEND_API_CONTRACT.md#переключаемая-диагностика-202203),
заново формирует запись с `source=backend` и собственной timestamp. Исходные
timestamp/module/error/message/stack и неизвестные поля отбрасываются. Backend-записи
не попадают в desktop-буфер, IPC или Renderer. Bootstrap и stdout-ready protocol прежние.

## Ограничения и безопасность

- Только статические названия событий; без диалогов, prompts, ключей, window titles,
  пользовательских путей и raw exception/provider details при любом уровне.
- Никаких frame/tick/input/token logs. Ошибка доставки Brain выводится не чаще раза
  в секунду, без очереди и догоняющих записей.
- Managed stderr: строка вместе с newline до 4096 UTF-8 bytes; framing buffer меньше
  4096 bytes; до 20 строк в фиксированное монотонное окно 1 s на child. Невалидные,
  oversized и незавершённые строки отбрасываются; после overflow чтение дренируется
  до newline. Поздние chunks retired child игнорируются.
- При backpressure записи теряются до `drain`, без очереди/retry. Ошибка вывода
  выключает sink и не останавливает backend или локальные FSM/Motion/input.

Состав диагностики, владельцы и lifecycle определены в
[Backend API §7](../../docs/contracts/BACKEND_API_CONTRACT.md#переключаемая-диагностика-202203).
