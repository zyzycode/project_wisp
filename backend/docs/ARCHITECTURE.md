# Архитектура backend

Backend — отдельный процесс с HTTP API, одним AI-провайдером и SQLite ledger.
Он возвращает семантические ответы; локальная память, FSM, физика и отображение
персонажа принадлежат desktop. Диалоги и пользовательская память на сервере не сохраняются.

## Модули

| Модуль | Ответственность |
|---|---|
| [main.py](../main.py), [application.py](../wisp_backend/application.py) | ASGI entry point и сборка приложения |
| [runtime.py](../wisp_backend/runtime.py) | Создание и закрытие ресурсов, maintenance |
| [api](../wisp_backend/api/) | HTTP boundary, маршруты, wire-схемы, преобразование запроса и сериализация ответа |
| [completion](../wisp_backend/completion/) | Выполнение запроса, дедлайны, отмена, политики сценариев, prompts и модели ответа |
| [providers](../wisp_backend/providers/) | Адаптеры Groq/Gemini, HTTP-транспорт, извлечение текста и usage |
| [accounting](../wisp_backend/accounting/) | Admission, квоты, ORM, учёт расхода и кеш повторных ответов |
| [config](../wisp_backend/config/) | Загрузка и проверка настроек, профили моделей |

`CompletionService` зависит от портов `Provider`, `Ledger`, `ReplyEncoder`.
Он не импортирует HTTP API или SQLAlchemy. `api` связывает wire DTO со сценарием;
`providers` возвращают текст и usage, не выбирая правила сценария.
`accounting` не зависит от API, completion, providers или config.

## Путь запроса

1. HTTP boundary ограничивает тело запроса, фиксирует дедлайн и следит за disconnect.
2. Wire-схема проверяет вход; `dispatch` создаёт `CompletionJob` с политикой сценария.
3. Ledger проверяет request ID и квоты, возвращает кешированный ответ либо резервирует токены.
4. Провайдер выполняет запрос. `ReplyEncoder` проверяет семантический ответ и создаёт JSON.
5. Ledger сохраняет расход. После commit ответ может попасть в RAM-кеш,
   если дедлайн не истёк и запрос не отменён.

Повторные вызовы, версии и ошибки определены в [общих API-контрактах](../../docs/contracts/README.md).
Автоматических retry, redirect и переключения провайдера при ошибке нет.
Ключи и prompts остаются на сервере; в ошибки и логи не попадают содержимое запросов и секреты.

## Хранение и ORM

Модели находятся в [accounting/models.py](../wisp_backend/accounting/models.py):

| Модель | Таблица | Данные |
|---|---|---|
| `LedgerMeta` | `meta` | Монотонное время и флаг остановки admission |
| `DailyUsage` | `days` | Дневные счётчики запросов и токенов |
| `LedgerEntry` | `entries` | ID, digest, состояние, время и резерв запроса |

[SQLiteLedger](../wisp_backend/accounting/sqlite_ledger.py) последовательно выполняет
операции под lock в worker thread. [storage.py](../wisp_backend/accounting/storage.py)
владеет настройкой соединения; каждая операция использует отдельную `Session`
с commit/rollback. ORM-объекты не выходят за границу адаптера. Арифметика токенов
выполняется в Python с сохранением точности больших целых.

База общая для всех endpoints одного процесса; несколько ASGI workers не поддерживаются.
Startup атомарно подготавливает схему и переводит незавершённые резервы в uncertain.
Restart сохраняет расходы. Ошибка хранилища останавливает admission.
ID хранятся 24 часа, дневные агрегаты — 30 суток. Очистка выполняется при startup
и каждые 60 секунд. Ответы хранятся только в RAM: до 100 записей, по 16 KiB, до 10 минут.

## Завершение запроса и процесса

Disconnect, timeout и shutdown отменяют upstream. Учёт завершается независимо от
доставки ответа; поздний usage может уточнить расход, но не восстановить ответ в кеше.
Shutdown прекращает приём, завершает запросы и фоновый учёт, затем закрывает
HTTP-клиент, maintenance task и ledger. Частичный startup также освобождает ресурсы.
