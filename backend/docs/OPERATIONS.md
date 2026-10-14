# Backend alpha: служебный учёт и запуск

Реализованные safeguards для `/v1/chat`, `/v1/touch`, `/v2/chat`,
`/v3/chat` и `/v3/events` следуют
[Backend API §5–6](../../docs/contracts/BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы).
Это один процесс и один ASGI worker с локальным SQLite ledger. Несколько workers
или общая БД для нескольких экземпляров этой конфигурацией не поддерживаются.

SQL-доступ реализован через SQLAlchemy ORM; модели таблиц находятся в
[accounting/models.py](../wisp_backend/accounting/models.py), драйвер SQLite остаётся стандартным
`sqlite3`. Один Engine/Connection принадлежит ledger и используется последовательно
в worker thread. Каждая операция создаёт собственную `Session` и явную транзакцию;
Session закрывается после commit или rollback. Connection закрывается и Engine
освобождается при shutdown или ошибке startup. Существующие файлы ledger продолжают
использоваться без пересоздания таблиц и сброса квот. Архитектурное решение и
проверка зависимости — [SQLAlchemy architect result](SQLALCHEMY_ARCHITECT_RESULT.md).

После обновления установить backend requirements выбранным Python:
`python -m pip install --only-binary=:all: -r requirements.txt` из `backend/`.
SQLAlchemy и его платформенная зависимость greenlet закреплены на проверенных
версиях; используются готовые wheels, установка компилятора не требуется.

## Конфигурация

Загрузка источников выполняется через `load_settings()` в
[config/loader.py](../wisp_backend/config/loader.py) один раз при startup.
[config/settings.py](../wisp_backend/config/settings.py) содержит модели настроек и их валидацию;
явно переданный в `create_app(settings=...)` объект обходит загрузку окружения.

| Переменная | Назначение |
|---|---|
| `WISP_AI_PROVIDER` | `groq` (default) или `gemini`; один активный provider, изменение после restart. |
| `WISP_AI_MODEL` | Optional проверенная модель; default определяется provider. |
| `GROQ_API_KEY` / `GEMINI_API_KEY` | Ключ только выбранного provider; `token_api` — legacy fallback только Groq. Хранить в `backend/.env`. |
| `WISP_AI_BASE_URL` | Optional URL совместимого API; blank — официальный endpoint выбранного provider. Только HTTPS либо loopback HTTP; userinfo/query/fragment запрещены. |
| `WISP_AI_MAX_OUTPUT_TOKENS` | Integer1–4096, default4096; events дополнительно ограничены1024. |
| `WISP_AI_TEMPERATURE` | Число0–2; blank — default провайдера. |
| `WISP_AI_THINKING_LEVEL` | Только Gemini: minimal/low/medium/high; minimal запрещён для Flash3.8. Blank — minimal для Flash-Lite, low для Flash. |
| `WISP_AI_REQUEST_TIMEOUT` | Общий серверный deadline в секундах: >0 и ≤10, default10; events сохраняют верхнюю границу2.5s. |
| `WISP_AI_CONNECT_TIMEOUT` / `WISP_AI_POOL_TIMEOUT` | >0 и ≤3 секунды, defaults3/3; дополнительно ограничиваются остатком deadline. |
| `WISP_LEDGER_PATH` | Явный путь к серверному ledger; по умолчанию `Path.home() / '.local' / 'state' / 'wisp-backend' / 'ledger.sqlite'`. |
| `WISP_LIMITS_JSON` | Объект с optional `rate_limit`, `concurrent_limit`, `daily_requests`, `daily_tokens`. Defaults: 12, 2, 100; tokens1000000 для Groq / 2000000 для Gemini. |
| `WISP_UPSTREAM_TRUST_ENV` | Только явное `true` включает proxy/TLS environment; default `false`. TLS verification включена, redirects запрещены. |

Пример limits: `{"rate_limit":12,"concurrent_limit":2,"daily_requests":100,"daily_tokens":1000000}`.
Значения — положительные integers; token cap не ниже reservation выбранной модели.
Поддерживаются Groq `openai/gpt-oss-20b` и Gemini `gemini-3.5-flash-lite`
(default) / `gemini-3.8-flash`; output cap ≤4096.
Gemini по умолчанию использует thinking level `minimal` для Flash-Lite и `low` для Flash;
output cap включает reasoning, поэтому усечённый ответ отклоняется с учётом usage.
Произвольная модель не принимается без нового review reservation profile.
Секреты настраиваются существующим серверным способом и не коммитятся.
Полный шаблон — [backend/.env.example](../.env.example); рабочий файл `backend/.env`
исключён из Git. Process environment имеет приоритет над одноимённым значением файла.
Пустые optional значения оставляют legacy ASSISTANTS_JSON/defaults; пустой provider
и отсутствующий ключ выбранного провайдера — ошибки. Env generation fields должны
совпадать с явно заданными полями ASSISTANTS_JSON. Недопустимые значения отклоняются
при startup, до сетевых запросов. Переменные provider не передаются launcher в desktop.

Для Google AI Studio задайте в `backend/.env`:

```dotenv
WISP_AI_PROVIDER=gemini
GEMINI_API_KEY=your-google-ai-studio-key
```

Перезапустите backend (`node scripts/wisp.mjs dev:backend` из корня).
Чтобы вернуться, установите `WISP_AI_PROVIDER=groq` и действующий `GROQ_API_KEY`.
Без `WISP_AI_MODEL` используется default выбранного provider. Если модель задана,
удалите override или выберите совместимую модель. `ASSISTANTS_JSON` сохраняется
для дополнительных server settings, но его явные provider/model должны совпадать
с переменными выбора; конфликт и неизвестная модель останавливают startup.
Наличие другого ключа не вызывает fallback. Ключи не вводятся в desktop UI.

Для нового поставщика разработчик добавляет профиль в
[profiles.py](../wisp_backend/config/profiles.py), реализацию существующего
порта и регистрацию в [factory.py](../wisp_backend/providers/factory.py), затем
проверяет reservation, данные и provider tests. Custom `WISP_AI_BASE_URL` задаёт
оператор: endpoint должен поддерживать протокол выбранного адаптера и получает
его ключ/контекст. При смене поставщика очистите URL override или задайте новый;
применяются те же условия передачи данных, что к официальному endpoint.

Каталог ledger должен быть доступен только оператору/сервисной учётной записи.
Он не связан с desktop SQLite и не входит в обычные alpha backups.
Ошибка открытия БД прерывает startup; ошибка дальнейшего I/O закрывает admission.
Restart сохраняет расходы; оставшиеся in-flight записи становятся uncertain charge.
При первой загрузке старый ledger получает reservation131072 для существующих записей.
Новые записи сохраняют собственный резерв; переключение provider не сбрасывает
budget/halt/requestId. После использования Gemini не запускайте старую версию
backend с фиксированным Groq accounting на этом ledger.
Удержанная reservation означает верхнюю оценку, а не подтверждённую оплату.
Reported usage сверх reservation сохраняется точно и блокирует новые обращения.
Оператор проверяет профиль и причину расхождения перед восстановлением admission;
удаление БД не является штатным способом сброса бюджета.

## Повторы, сроки и данные

Все пять routes используют общие rate/concurrency/day budgets и namespace requestId.
Replay возможен только из bounded RAM cache. Restart/eviction/expiry ответа
оставляет conflict до TTL ID; новый вызов с тем же ID автоматически не выполняется.
Совместимость прежнего body-only digest ограничена точным `/v1/chat`.
У chat/touch body ограничен 2s, вся операция — 10s с учётом admission и settlement;
у `/v3/events` — соответственно 0.5s и 2.5s.
Disconnect/shutdown отменяют upstream; поздний ответ не заменяет terminal outcome.

Ledger хранит ID/digest/состояние/время и расход, без body, character или ответов.
ID retention — 24h, aggregates — 30 суток; cleanup при startup и каждые 60s.
Response cache — только RAM, ≤100 ответов по ≤16KiB, ≤10min.
SQLite использует secure_delete и DELETE journal. Диагностика не должна включать
payload/provider errors; оператор ограничивает безопасные logs семью сутками.

До внешней alpha оператор отдельно проверяет private ingress, HTTPS, отзываемый
сетевой доступ и data policy выбранного provider по canonical контракту:
Groq ZDR либо отдельные условия Gemini (paid service, регион, retention55дней).
До этой проверки используются только синтетические данные. Эти настройки не
подтверждаются mocked tests и не заменяются успешной поставкой кода.

## Явная память v2

`POST /v2/chat` принимает selected memory по
[Memory §1–5](../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#1-версия-и-границы).
Desktop явно выбирает v2; default v1 не переключается. Пустая memory projection
разрешена, пропущенный объект — ошибка. Один provider call возвращает текст
и optional candidates с evidenceQuote из текущей user-реплики. Локальный recognizer
независимо решает, что сохранить; ответ модели не подтверждает durable write.
Backend не хранит пользовательский профиль/эпизоды и не пишет их в logs/ledger.
Разрешённая передача и удаление определены в
[Memory §4](../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#4-данные-и-удаление).

## События и follow-up v3

`/v3/events` принимает только `cursor_game_completed` с фактическим исходом
desktop или `social_bid_started` уже начавшегося жеста. Ответ — text-only
≤240 UTF-16 units, output cap1024; лишние model fields запрещены и при ошибке
usage всё равно учитывается. Сервер не запускает игру/жест и не продлевает их.

`/v3/chat` сохраняет v2 memory semantics с optional `previousInitiative`:
это ранее опубликованная AI-фраза, не user message и не источник нового факта.
Один текущий пользовательский запрос остаётся единственным источником evidenceQuote.
Поля, deadlines и данные определены в
[Events §5](../../docs/contracts/AI_EVENTS_CONTRACT.md#5-явный-wire-v3-и-данные).
Local quiet/reset/dispose и causal generation guards остаются desktop.
Текущие default launcher settings и отключённые по умолчанию events не изменены.
