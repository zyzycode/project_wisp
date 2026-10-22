# Архитектура backend

> [!IMPORTANT]
> **Unified v1 Alpha:** backend и desktop используют один актуальный контракт.
> Wire-поля `version` и поддержки старых клиентов нет; desktop и backend обновляются совместно.
> Маршруты: `POST /v1/chat`, `/v1/touch`, `/v1/events`, `/v1/observation`,
> `/v1/summary` и `GET /health`. Chat/touch всегда возвращают appraisal.
> Клиент и сервер обновляются совместно; обратной совместимости со старыми API нет.

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
| [providers](../wisp_backend/providers/) | Адаптеры Groq/Gemini/OpenAI, HTTP-транспорт, извлечение текста и usage |
| [accounting](../wisp_backend/accounting/) | Защита от повторов, ORM, учёт расхода и кеш повторных ответов |
| [config](../wisp_backend/config/) | Загрузка и проверка настроек, профили моделей |

`CompletionService` зависит от портов `Provider`, `Ledger`, `ReplyEncoder`.
Он не импортирует HTTP API или SQLAlchemy. `api` связывает wire DTO со сценарием;
`providers` возвращают текст и usage, не выбирая правила сценария.
`accounting` не зависит от API, completion, providers или config.

## Путь запроса

1. HTTP boundary ограничивает тело запроса, фиксирует дедлайн и следит за disconnect.
2. Wire-схема проверяет вход; `dispatch` преобразует его в контекст конкретного сценария.
   Политика проверяет тип контекста, строит блоки и задаёт parser/лимиты `CompletionJob`.
3. Ledger проверяет request ID, возвращает кешированный ответ либо открывает запись учёта.
4. Provider adapter отбирает контекст: Gemini использует countTokens, Groq/OpenAI —
   консервативную локальную оценку. Все preflight и generation делят исходный deadline.
   После одного inference `ReplyEncoder` проверяет семантический ответ и создаёт JSON.
5. Ledger сохраняет расход. После commit ответ может попасть в RAM-кеш,
   если дедлайн не истёк и запрос не отменён.

Повторные вызовы и ошибки определены в [общих API-контрактах](../../docs/contracts/README.md).
Автоматических retry, redirect и переключения провайдера при ошибке нет.
Ключи и prompts остаются на сервере; в ошибки и логи не попадают содержимое запросов и секреты.

### OpenAI

`WISP_AI_PROVIDER=openai` выбирает серверный `OPENAI_API_KEY`, официальный endpoint
`https://api.openai.com/v1/` и по умолчанию `gpt-4.1-mini`. Для тестов качества
можно явно выбрать `WISP_AI_MODEL=gpt-6-astra`. При переключении с Gemini очистить
`WISP_AI_MODEL`, `WISP_AI_BASE_URL` и `WISP_AI_THINKING_LEVEL`, чтобы применились
профильные значения. Все настройки перечислены в [.env.example](../.env.example).

[Адаптер](../wisp_backend/providers/openai.py) использует text Chat Completions,
JSON mode, `store=false`, без tools/files/batch. Это расширение существующего
`Provider`/`HTTPProvider`; новые зависимости, wire DTO и клиентские ключи не нужны.
Refusal, незавершённый вывод и tool calls считаются `invalid_model_response`;
достоверный usage сохраняется даже при отклонении текста.

Для GPT-6 Astra сервер задаёт `reasoning_effort=low`; `WISP_AI_TEMPERATURE` должен
быть пустым, иначе startup отклоняет конфигурацию. Настройка `WISP_AI_THINKING_LEVEL`
остаётся только для Gemini. Совместимость параметров — по [OpenAI migration guide](https://developers.openai.com/api/docs/guides/latest-model).
Reasoning входит в `completion_tokens` и общий output cap; deadlines и лимиты
сценариев сохраняются. Более мощная модель может завершиться timeout/length;
mock-тесты подтверждают протокол, но не качество и задержку живой модели.

Preflight оценивает полный JSON payload: UTF-8 bytes + 256 + 64 × число сообщений.
Это локальная консервативная оценка, а не точный tokenizer; отдельного count HTTP нет.
Локальный ceiling — 16384 вместе с output cap; reservation неизвестного usage —
1050000 для обоих OpenAI-профилей по максимальному [контекстному окну Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).
Retention и удаление определены в [API §6](../../docs/contracts/BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление).

## Сценарии и prompt engineering

Набор сценариев для клиента:
- **Chat** — диалог с историей, локальной проекцией памяти и эмоциональной оценкой.
- **Events** — короткая речь по подтверждённым игровым и социальным событиям.
- **Touch** — реакция на прямое физическое касание (клик).
- **Observation** — реакция на активные приложения и окна пользователя.
- **Summary** — сжатие диалога.

[Внутренние контексты](../wisp_backend/completion/prompts/context.py) типизированы по сценарию:
chat явно требует память и interaction policy; summary содержит только пары
источника; observation — персонажа и метаданные окна; touch/events — собственное событие.
Входные HTTP-модели остаются в `api`, `dispatch` выбирает один из пяти сценариев.
Проверенные снимки character/memory/card сериализуются как данные без копирования
wire-схем во внутренний слой. Интерпретируемые поля — типизированные значения;
пары диалога и summary передаются кортежами.

Редактирование текста базовых инструкций не меняет контракт v1 через поиск/замену строки. Источник личности — desktop preset; сервер объясняет модели текущее состояние и границы. Карта файлов и приоритеты — в [Context/Prompt Engine](CONTEXT_PROMPT_ENGINE.md).

## Хранение и ORM

Модели находятся в [accounting/models.py](../wisp_backend/accounting/models.py):

| Модель | Таблица | Данные |
|---|---|---|
| `LedgerMeta` | `meta` | Монотонное время учёта |
| `DailyUsage` | `days` | Дневные счётчики запросов и токенов |
| `LedgerEntry` | `entries` | ID, digest, состояние, время и резерв запроса |

[SQLiteLedger](../wisp_backend/accounting/sqlite_ledger.py) последовательно выполняет
операции под lock в worker thread. [storage.py](../wisp_backend/accounting/storage.py)
владеет настройкой соединения; каждая операция использует отдельную `Session`
с commit/rollback. ORM-объекты не выходят за границу адаптера. Арифметика токенов
выполняется в Python с сохранением точности больших целых.

База общая для всех endpoints одного процесса; несколько ASGI workers не поддерживаются.
Startup атомарно подготавливает схему через `Base.metadata.create_all()` и переводит незавершённые резервы в uncertain.
Restart сохраняет расходы. Учёт, включая uncertain и старый флаг halt, не ограничивает
новые запросы. Собственных квот частоты, параллельности и дневного расхода нет;
`WISP_LIMITS_JSON` игнорируется. Лимиты провайдера действуют независимо.
Ошибка хранилища останавливает admission для сохранения защиты от повторной отправки.
ID хранятся 24 часа, дневные агрегаты — 30 суток. Очистка выполняется при startup
и каждые 60 секунд. Ответы хранятся только в RAM: до 100 записей, по 16 KiB, до 10 минут.

### Схема данных и разработка (Dev Workflow)

* **Инициализация:** Таблицы создаются декларативно через `Base.metadata.create_all()` в [initialize_schema](../wisp_backend/accounting/storage.py). Ручные SQL-миграции и ad-hoc `ALTER TABLE` в коде исключены.
* **Сброс при изменении моделей:** В процессе разработки при изменении моделей в [accounting/models.py](../wisp_backend/accounting/models.py) база сбрасывается простым удалением файла SQLite:
  * Путь по умолчанию: `~/.local/state/wisp-backend/ledger.sqlite` (или значение `WISP_LEDGER_PATH` из окружения).
  * Команда сброса (Linux / macOS):
    ```bash
    rm -f ~/.local/state/wisp-backend/ledger.sqlite*
    ```
  * Команда сброса (Windows PowerShell):
    ```powershell
    Remove-Item "$HOME/.local/state/wisp-backend/ledger.sqlite*" -ErrorAction SilentlyContinue
    ```
  * При следующем старте бэкенда актуальная схема будет создана автоматически.
* **Переход на Alembic:** Полноценное версионирование схемы (Alembic) подключается позже, при стабилизации схемы и переходе к постоянной серверной инфраструктуре.

## Завершение запроса и процесса

Disconnect, timeout и shutdown отменяют upstream. Учёт завершается независимо от
доставки ответа; поздний usage может уточнить расход, но не восстановить ответ в кеше.
Shutdown прекращает приём, завершает запросы и фоновый учёт, затем закрывает
HTTP-клиент, maintenance task и ledger. Частичный startup также освобождает ресурсы.
