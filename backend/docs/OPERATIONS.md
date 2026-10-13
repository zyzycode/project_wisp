# Backend alpha: служебный учёт и запуск

Реализованные safeguards для `/v1/chat`, `/v1/touch` и `/v2/chat` следуют
[Backend API §5–6](../../docs/contracts/BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы).
Это один процесс и один ASGI worker с локальным SQLite ledger. Несколько workers
или общая БД для нескольких экземпляров этой конфигурацией не поддерживаются.

## Конфигурация

| Переменная | Назначение |
|---|---|
| `WISP_LEDGER_PATH` | Явный путь к серверному ledger; по умолчанию `Path.home() / '.local' / 'state' / 'wisp-backend' / 'ledger.sqlite'`. |
| `WISP_LIMITS_JSON` | Объект с optional `rate_limit`, `concurrent_limit`, `daily_requests`, `daily_tokens`. Defaults: 12, 2, 100, 1000000. |
| `WISP_UPSTREAM_TRUST_ENV` | Только явное `true` включает proxy/TLS environment; default `false`. TLS verification включена, redirects запрещены. |

Пример limits: `{"rate_limit":12,"concurrent_limit":2,"daily_requests":100,"daily_tokens":1000000}`.
Значения — положительные integers; token cap не ниже 131072. Поддерживается
рассмотренный профиль Groq `openai/gpt-oss-20b`, output cap ≤4096.
Произвольная модель не принимается без нового review reservation profile.
Секреты настраиваются существующим серверным способом и не коммитятся.

Каталог ledger должен быть доступен только оператору/сервисной учётной записи.
Он не связан с desktop SQLite и не входит в обычные alpha backups.
Ошибка открытия БД прерывает startup; ошибка дальнейшего I/O закрывает admission.
Restart сохраняет расходы; оставшиеся in-flight записи становятся uncertain charge.
Удержанная reservation означает верхнюю оценку, а не подтверждённую оплату.
Reported usage сверх reservation сохраняется точно и блокирует новые обращения.
Оператор проверяет профиль и причину расхождения перед восстановлением admission;
удаление БД не является штатным способом сброса бюджета.

## Повторы, сроки и данные

Все три routes используют общие rate/concurrency/day budgets и namespace requestId.
Replay возможен только из bounded RAM cache. Restart/eviction/expiry ответа
оставляет conflict до TTL ID; новый вызов с тем же ID автоматически не выполняется.
Совместимость прежнего body-only digest ограничена точным `/v1/chat`.
Body ограничен 2s, вся операция — 10s с учётом admission и settlement.
Disconnect/shutdown отменяют upstream; поздний ответ не заменяет terminal outcome.

Ledger хранит ID/digest/состояние/время и расход, без body, character или ответов.
ID retention — 24h, aggregates — 30 суток; cleanup при startup и каждые 60s.
Response cache — только RAM, ≤100 ответов по ≤16KiB, ≤10min.
SQLite использует secure_delete и DELETE journal. Диагностика не должна включать
payload/provider errors; оператор ограничивает безопасные logs семью сутками.

До внешней alpha оператор отдельно проверяет private ingress, HTTPS, отзываемый
сетевой доступ, Groq ZDR, регион и retention по canonical контракту.
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
