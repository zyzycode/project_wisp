# Архитектура backend

Backend — один процесс FastAPI с одним активным AI-провайдером и служебным
SQLite ledger. Точка входа — [main.py](../main.py), сборка приложения —
[application.py](../wisp_backend/application.py). Внешние HTTP-контракты v1/v2/v3,
переменные окружения и существующие файлы ledger совместимы с предыдущей структурой.

## Владение модулями

| Пакет | Ответственность |
|---|---|
| [api](../wisp_backend/api/) | HTTP boundary, маршруты, wire-схемы, преобразование входа в задание, сериализация ответа и OpenAPI |
| [completion](../wisp_backend/completion/) | Выполнение задания, дедлайн, отмена, завершение учёта; политики сценариев, prompts и семантические модели ответа |
| [providers](../wisp_backend/providers/) | HTTP-клиент, протоколы Groq/Gemini, извлечение текста и usage, транспортные ошибки |
| [accounting](../wisp_backend/accounting/) | Admission, квоты, переходы состояний учёта, SQLAlchemy ORM/SQLite и ограниченный кеш replay |
| [config](../wisp_backend/config/) | Загрузка environment/.env, проверка настроек и каталог моделей |
| [runtime.py](../wisp_backend/runtime.py) | Создание ресурсов и освобождение в обратном порядке, включая частичный startup |

Общие модули `errors.py`, `validation.py`, `json_codec.py` и `outcomes.py`
содержат безопасные ошибки, правила значений, строгий JSON и снимок ответа для replay.
Они не импортируют конкретные адаптеры или приложение.

## Путь запроса

1. [CompletionBoundary](../wisp_backend/api/boundary.py) ограничивает чтение тела,
   фиксирует начало дедлайна, вычисляет digest и следит за disconnect.
   [endpoints.py](../wisp_backend/api/endpoints.py) связывает путь, версию,
   wire-модели, сценарий и legacy-совместимость digest.
2. FastAPI проверяет wire DTO. [dispatch.py](../wisp_backend/api/dispatch.py)
   преобразует его в нормализованный контекст и `CompletionJob`.
3. [policies.py](../wisp_backend/completion/policies.py) задаёт prompt builder,
   семантическую модель ответа, дедлайн и output cap сценария. HTTP-версии
   и requestId не входят в контекст провайдера.
4. [CompletionService](../wisp_backend/completion/service.py) выполняет admission,
   получает replay либо вызывает единственный внедрённый `Provider`.
   Runtime ограничивает дедлайн дополнительно к политике сценария.
5. Провайдер возвращает `ProviderResult`: сырой текст, usage и безопасный код
   ошибки. Он не выбирает правила chat/touch/events и не валидирует их содержимое.
6. Внедрённый `ReplyEncoder` проверяет семантику через выбранную политику и создаёт
   HTTP envelope. Некорректный текст не теряет уже полученный usage.
7. Ledger завершает учёт в транзакции. Только после commit разрешена публикация
   точных байтов ответа в ограниченный RAM-кеш с проверкой дедлайна и отмены.

`Outcome(status, body)` — непрозрачный снимок доставки для replay. Execution и
accounting не создают Starlette Response, не разбирают envelope и не зависят
от HTTP-схем. Повтор использует те же байты, включая безопасный ответ об ошибке.

## Направление зависимостей

- `api` использует completion-контракты и политики; completion не импортирует API.
- `CompletionService` зависит от портов `Provider`, `Ledger`, `ReplyEncoder`.
  В нём нет выбора wire-версии, модели провайдера или SQL-реализации.
- `providers` реализуют порт inference. Настройки выбранной модели связываются
  с адаптером при startup; конфигурация не передаётся через каждый вызов сервиса.
- `accounting` не импортирует API, completion, providers или config.
  Лимиты передаются через структурный интерфейс `LedgerLimits`.
- [policy.py](../wisp_backend/accounting/policy.py) рассчитывает решения без I/O;
  [sqlite_ledger.py](../wisp_backend/accounting/sqlite_ledger.py) атомарно применяет
  их, владеет блокировкой и соединением. [replay.py](../wisp_backend/accounting/replay.py)
  отвечает за TTL, вместимость и запрет публикации отменённых ответов.

ORM-модели находятся в [accounting/models.py](../wisp_backend/accounting/models.py):
`LedgerMeta` → `meta`, `DailyUsage` → `days`, `LedgerEntry` → `entries`.
[storage.py](../wisp_backend/accounting/storage.py) создаёт отдельную `Session`
с явной транзакцией на каждую операцию ledger. Модели и Session остаются внутри
адаптера; наружу возвращаются обычные `Admission`/`Usage`/`Outcome`.
Существующая SQLite-схема сохраняется, включая точное хранение больших счётчиков;
startup migration и восстановление незавершённых запросов атомарны.

SQLAlchemy остаётся внутри accounting. Один worker, no retry/redirect, ограничения
данных и server-only credentials сохраняются. `ASSISTANTS_JSON` читается для
совместимости; runtime использует профиль `default`, без маршрутизации между ассистентами.

## Завершение и диагностика

Shutdown прекращает приём, отменяет активные запросы и завершает независимый
учёт; затем закрывает HTTP-клиент, maintenance task и ledger. Поздний результат
может уточнить usage, но не восстановить опубликованный success после timeout.

Ошибки фонового учёта и обслуживания дают фиксированные сигналы
`completion_background_failed` и `ledger_maintenance_failed`. В них нет текста
исключений, SQL, диалогов, prompts или ключей. После ошибки maintenance адаптер
остаётся закрытым для новых операций; восстановление требует перезапуска.

## Изменения и проверки

Для нового сценария определить семантический ответ и политику, затем wire-модели,
endpoint и преобразование контекста. Общий execution и provider adapters должны
оставаться независимыми от списка сценариев.

Тесты расположены в `tests/api`, `tests/completion`, `tests/accounting`,
`tests/providers`, `tests/config`. Общие фабрики — `tests/helpers.py`,
изолированные адаптеры — `tests/doubles.py`. `tests/test_dependencies.py`
проверяет направление импортов. Путь `tests/desktop_integration_bridge.py`
сохранён для существующего desktop harness.

Проверка: `python -m pip check`, затем `python -m pytest -q` из `backend/`.
Все provider-вызовы в тестах подменены; проверка proxy использует локальный сервер.
