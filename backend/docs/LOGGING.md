# Backend logging

Общий stdlib logging применяется к lifecycle, HTTP, completion и обслуживанию ledger.
Настройка принадлежит одному runtime процесса; несколько приложений в одном процессе
не имеют независимых настроек. Зависимостей и постоянного хранения нет.

## Автору модуля

```python
from wisp_backend.logging import get_logger, log_context

logger = get_logger(__name__)
with log_context(operation="maintenance"):
    logger.debug("operation_started", fields=lambda: {"count": 3})
    logger.info("operation_finished", fields={"duration_ms": 12.5})
```

Имена logger/event — **константы исходного кода**, не ввод пользователя, f-string,
текст ошибки или ответ провайдера. Event — lowercase `a-z0-9_.`, максимум 80 символов.
Неверное имя заменяется `invalid_event`. Этот синтаксический фильтр не распознаёт секрет,
закодированный в допустимое имя: запрет динамических имён обязателен при code review.
Не передавать raw данные даже в отбрасываемые поля.

`logger.exception("operation_failed")` внутри except либо
`logger.error("operation_failed", error=error, fields={"category": "unexpected"})`
сохраняет до четырёх причин: builtin type (прочие — ApplicationError) и последнюю
позицию в wisp_backend. Сообщения, locals, аргументы, полный traceback и provider frames
не сохраняются. Циклы причин обрываются. Ожидаемые ошибки используют category из
ServiceError и outcome=expected; неожиданные — unexpected.

DEBUG — подробности этапов; INFO — завершение операции/lifecycle;
WARNING — ожидаемый отказ; ERROR — сбой; CRITICAL — невозможность продолжать runtime.
Ленивый `fields=lambda: ...` вызывается только для включённого уровня. Callback должен
быть быстрым и без побочных эффектов; его программные ошибки не маскируются.

## Контекст и поля

`log_context` генерирует собственный случайный correlation_id; вложенные вызовы и
созданные внутри asyncio tasks его наследуют. При исключении/отмене scope очищается;
уже созданная дочерняя task сохраняет свой snapshot, включая фоновой settlement.
Внешние request ID, headers и IP не попадают в журнал. HTTP использует только известный
route или `other`, без query, body и адреса клиента.

Схема в [logging_fields.py](../wisp_backend/logging_fields.py):
числа `duration_ms`, `count`, `status_code`, `queue_depth`, `dropped`, `output_errors`
от 0 до 1e12, конечные; closed enums `operation`, `outcome`, `method`, `route`, `category`.
Неизвестные ключи, вложенные структуры, строки вне enum и объекты отбрасываются;
произвольный repr/str не вызывается. Глубина metadata — один уровень, объём ограничен
числом разрешённых ключей. JSON/console экранируют управляющие символы, ANSI не используется.
Расширять поля следует централизованно, проверив отсутствие пользовательских данных.

## Настройка

Перезапуск обязателен; process environment приоритетнее backend/.env.

| Переменная | Default | Допустимые значения |
|---|---|---|
| WISP_LOG_FORMAT | console | console, json |
| WISP_LOG_LEVEL | INFO | DEBUG, INFO, WARNING, ERROR, CRITICAL, OFF |
| WISP_LOG_OVERRIDES | {} | JSON object module → level, до 32 overrides |
| WISP_LOG_QUEUE_CAPACITY | 1024 | 1–10000 записей |
| WISP_LOG_SHUTDOWN_TIMEOUT | 0.2 | 0–2 секунды |

Overrides наследуются дочерними logger по правилам stdlib. Для уже загруженных
сторонних библиотек default WARNING, чтобы не включать SQL/transport chatter; override
может включить DEBUG выбранному дереву библиотечных logger (текст остаётся скрытым). Неверная настройка
останавливает startup безопасной ошибкой без echo значений. Bootstrap устанавливает
безопасный handler до чтения runtime settings. После shutdown поздние library logs
отбрасываются; стандартные Uvicorn final сообщения заменяет application_stopped.
Повторная инициализация закрывает предыдущий sink и не умножает handlers.
При вызове CLI использовать `uvicorn main:app --no-access-log`: main устанавливает
безопасную конфигурацию; штатный `python main.py` уже выключает access log.
Сырые сообщения Uvicorn/HTTPX/httpcore и прочих библиотек заменяются `external_log`;
аргументы, exception text и произвольный extra не сериализуются. Подробности HTTP
дают собственные события. Нельзя устанавливать сторонние handlers после startup.

## Формат и поиск

Console (без цвета, пригоден для pipe):

```text
2026-10-23T10:00:00.000+00:00 INFO wisp_backend.api.logging http_finished {"context":{"correlation_id":"..."},"fields":{"duration_ms":12.5,"status_code":200}}
```

JSON lines (timestamp всегда UTC):

```json
{"timestamp":"2026-10-23T10:00:00.000+00:00","level":"INFO","module":"wisp_backend.api.logging","event":"http_finished","context":{"correlation_id":"...","operation":"http","route":"/health","method":"GET"},"fields":{"status_code":200,"duration_ms":12.5,"outcome":"success"}}
```

Для диагностики задержки включить `WISP_LOG_OVERRIDES={"wisp_backend.completion":"DEBUG"}`:
provider_started/provider_finished и http_finished имеют один correlation_id и duration_ms.
Фильтрация внешнего JSON-потока: `jq 'select(.context.correlation_id == "ID")'`;
ошибки: `jq 'select(.level == "ERROR" or .level == "CRITICAL")'`.

## Вывод и ограничения

Queue bounded; producer не ждёт stdout/stderr. При заполнении **новейшая запись любого
уровня отбрасывается**; ERROR не гарантирован. Следующая успешно выведенная запись
содержит logging_health с накопленными dropped/output_errors. Счётчики доступны также
на LogRuntime. Неисправный sink не вызывает recursive logging или утечки текста ошибки.
Shutdown ждёт не больше настроенного срока; остаток queue отбрасывается. Одну уже
начатую системную запись нельзя отменить: daemon thread может оставаться до завершения
процесса. Повторная конфигурация при таком stuck writer не создаёт новые threads:
логирование остаётся выключенным до освобождения writer и следующей инициализации.
Логи best effort, не audit trail. OFF выключает события, если override не включает их.

Форматирование, фильтрация и context отделены от sink. Новый вывод подключается
централизованно через configure_logging(output=...), а не из бизнес-кода.
Файлы, ротация, архивирование и внешняя доставка не реализованы и требуют отдельного
согласования. Оператор внешнего сборщика stdout/stderr обязан соблюдать retention
**не более 7 суток**; logger сам ничего не хранит на диске.

## Проверки и benchmark

Из backend: `.venv/bin/python -m wisp_backend.logging_benchmark`.
1000 синтетических операций, INFO finish и DEBUG start, JSON в StringIO, без HTTP/LLM;
выводит producer µs/operation, bytes и потери отдельно для OFF/INFO/DEBUG.
Это локальная стоимость логгера, не latency HTTP и не измерение дискового collector.
При потерях увеличить bounded queue либо уменьшить уровень; при output_errors проверить
доступность stdout/stderr; после stuck output перезапустить процесс.
