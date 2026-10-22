# Desktop ↔ Backend v1: wire-контракт

Канонический внешний API. Не зависит от Domain, Electron, локальных Application DTO или выбранного серверного языка. Полные формы полей и enum — [backend-ai-contract.ts](../../frontend/src/application/ports/backend-ai-contract.ts): файл самодостаточен, без импортов. Изменение локальных типов персонажа не меняет wire автоматически; преобразование принадлежит desktop adapter. Клиентский lifecycle и ограничения частоты — в [AI Provider](../../frontend/docs/engine/AI_PROVIDER_CONTRACT.md#desktop--backend-v1).

## 1. Транспорт и владение

- `POST /v1/chat`, JSON UTF-8; request `Content-Type: application/json`, `Accept: application/json`, JSON responses `Content-Type: application/json`. Успех — HTTP 200. Только `stream: false`; SSE, tools и файлы не входят в v1.
- Удалённый backend — HTTPS; HTTP допустим только loopback при разработке. Base URL — доверенная конфигурация Main. Desktop не следует redirect, не принимает URL от Renderer/модели.
- Первая версия без авторизации, cookies и login UI. LLM credential остаётся на backend; requestId/IP/installation ID не подтверждают личность пользователя.
- Backend формирует system prompt, выбирает модель, проверяет вход и модельный вывод. Пользовательские сообщения и character — недоверенные данные, не системные инструкции. Модель не исполняет команды, не выбирает URL/инструменты и не меняет сохранённое состояние desktop.
- Отправляются только текущий ограниченный диалог и character projection. Экран, окна, курсор, файлы, memories и credentials не входят в запрос. Server dialogue state не требуется: каждый запрос содержит свой контекст. История не пишется в application logs; ошибки не раскрывают prompts, stack traces или provider internals.

## 2. Поля и валидация

`version` строго 1; `requestId` — UUID v4, созданный desktop для нового обращения. Backend возвращает тот же ID. Локальные conversationId/generation/streamId не отправляются. `event.type` только `user_message`; `locale` только `ru`/`en`.

`messages`: 1–7 записей, до трёх полных пар истории и последнее user message, порядок `user, assistant, …, user`. `role` только user/assistant; content после trim непустой, user ≤240, assistant ≤2000 UTF-16 code units. System/developer/tool roles запрещены. Данные example не заменяют реальную character projection.

Все числовые границы **включительные**, числа конечные; числовые строки, null, NaN/Infinity и выход за диапазон не принимаются. Boolean поля принимают только JSON boolean, не 0/1 или строки. Отсутствие допускается только для полей, помеченных optional в wire type.

| Поле character | Диапазон / тип |
|---|---|
| `needs.energy`, `attention`, `play`, `comfort` | `[0, 100]`, обязательны |
| `needs.boredom` | `[0, 100]`, optional; отсутствие не заменять нулём |
| `personality.traits.shyness`, `playfulness`, `sensitivity`, `boldness` | `[0, 1]`, все четыре обязательны |
| `relationship.friendship`, `love` | `[0, 1000]` |
| `relationship.loveUnlocked` | boolean |
| `intimacy.flirtiness`, `romanticCharge` | `[0, 100]` |
| `intimacy.userConsentEnabled` | boolean |
| `personality.presetId` | непустая строка, ≤128 code units |
| `personality.aiSelfConcept` | непустая строка, ≤500 code units |
| `synthesizedTone` | отдельный wire enum `BackendCharacterTone` |

Request body ≤32 KiB, response body ≤16 KiB после декодирования; превышение прекращает чтение. Неизвестные ключи/неверная форма отклоняются, в том числе произвольные needs keys; исключение для необязательных response hints описано ниже. Текст plain text, контролы кроме newline/tab запрещены. Длины строк считаются в UTF-16 code units на обеих сторонах; нормализация не делает out-of-range значение допустимым.

Успех содержит version/requestId/text и optional decision. `text` после trim 1–2000 code units. `decision`: обязательные behavior и confidence, optional tone/mood; confidence finite `[0,1]`. Перечни behavior/tone/mood автономно определены wire-типами. Отсутствующий decision — корректный text-only success. Обязательного или optional поля quota в согласованной форме сейчас нет.

Модель предлагает одно semantic behavior; локальный Character проверяет актуальность, P0–P5, Needs, сон, quiet и cooldown. Confidence не даёт приоритет или право исполнения. Координаты, маршруты, клипы, длительности, изменение числовых traits/отношений, memory writes и команды ОС запрещены. Backend сам формирует envelope/requestId, не доверяет этим полям модельного вывода.

Некорректный decision при валидном тексте backend удаляет целиком и возвращает text-only success; desktop также отбрасывает некорректный decision. Невалидный обязательный envelope/text/version/requestId делает ответ целиком невалидным. Эта деградация hints не разрешает дополнительные поля верхнего уровня.

## 3. HTTP и ошибки

Ошибка содержит version/requestId/error; точная форма — `BackendAIErrorResponse`. requestId=null только когда входной ID не прочитан/невалиден. HTTP status и error.code должны соответствовать таблице; неожиданный status, HTML, пустое тело или несовместимая пара — transport/protocol failure у desktop, без принятия model decision.

| HTTP | `error.code` | Значение |
|---|---|---|
| 400 | `invalid_request` | Невалидные JSON, поля, enums или диапазоны. |
| 400 | `unsupported_version` | Версия API не поддерживается. |
| 413 | `payload_too_large` | Размер payload превышает допустимый. |
| 409 | `request_conflict` | Изменён body либо результат уже нельзя повторить; см. §5. |
| 409 | `request_in_progress` | Этот ID с тем же body сейчас обрабатывается; см. §5. |
| 429 | `rate_limited` | Сохранён для совместимости wire; текущий backend не применяет локальные квоты. |
| 429 | `budget_exhausted` | Сохранён для совместимости wire; текущий backend не применяет дневные бюджеты. |
| 503 | `upstream_unavailable` | LLM/provider недоступен. |
| 504 | `upstream_timeout` | Deadline серверного вызова истёк. |
| 502 | `invalid_model_response` | Нельзя получить валидный текст из ответа модели. |

`error.retryAfterMs` optional: integer 1–86 400 000 ms; это подсказка о минимальном ожидании, не гарантия будущего admission и не команда автоматически повторять запрос. Наличие/отсутствие поля не определяет формулу серверной квоты. Техническое сообщение пользователю desktop берёт из локального каталога, не из provider error body.

## 4. Общие JSON fixtures

Эти файлы — общие payload fixtures для desktop и backend. Использовать один и тот же JSON, не пересобирать вручную отдельные примеры. HTTP status — транспортные метаданные из таблицы, не поле JSON body.

| Fixture | Использование |
|---|---|
| [request.valid.json](fixtures/desktop-backend-v1/request.valid.json) | Валидное тело POST /v1/chat. |
| [response.success.json](fixtures/desktop-backend-v1/response.success.json) | HTTP 200, успешный ответ на этот requestId. |
| [response.error.json](fixtures/desktop-backend-v1/response.error.json) | HTTP 503, альтернативный error outcome того же запроса. |

Success и error — альтернативы, не два ответа одного исполнения. В реализации обе стороны дополнительно проверяют границы 0/верхний предел, значения за ними, неверный тип, отсутствие обязательного поля, неизвестный ключ, text-only success и malformed decision.

## 5. Закрытая alpha: серверный admission, учёт и повторы

Решение [#52](https://github.com/zyzycode/project_wisp/issues/52); текущая структура реализации — [архитектура backend](../../backend/docs/ARCHITECTURE.md). Wire v1, его типы и fixtures не меняются; quota/auth metadata не добавляются. Ниже — контракт реализованного общего runtime; перечень endpoints — в серверной архитектуре. Клиентские ограничения остаются независимыми.


Один admission, ledger и RAM replay cache обслуживают `POST /v1/chat`, `/v1/touch`, `/v2/chat`, `/v3/chat`, `/v3/events`, `/v5/chat`, `/v5/summary`, `/v6/observation`, `/v7/chat`, `/v7/touch`. Все обращения учитываются совместно; health не вызывает provider и не создаёт запись расхода. Версия error envelope определяется endpoint, включая ошибки до parsing; v1/touch использует version1 и ту же таблицу §3. Полная валидация соответствующего wire выполняется до admission.

### Доступ и топология

Один экземпляр сервера, один ASGI worker, один локальный durable SQLite ledger через существующий SQLAlchemy ORM adapter с драйвером `sqlite3`. Внешняя SQL-служба/Redis не используются. Admission атомарен, работа с ledger не блокирует event loop; I/O failure закрывает новые обращения с 503, без вызова LLM. Многопроцессный/горизонтальный запуск вне этой схемы.

Без application auth разрешены только разработка через loopback и закрытый тест через управляемый оператором приватный туннель/VPN с индивидуально отзываемым сетевым доступом; удалённый endpoint всё равно HTTPS. Публичный ingress закрыт. Это ограничение сети, не личность пользователя в API: IP/requestId/installation ID не используются как аккаунт. Публичная регистрация и персональные квоты потребуют отдельного auth-контракта. Перед допуском тестеров оператор проверяет сетевой запрет и настройки хранения у провайдера (§6).

### Учёт расхода

Backend не ограничивает частоту, число одновременных запросов, дневное число запросов
или дневной расход токенов. `WISP_LIMITS_JSON` не используется. Ограничения выбранного
провайдера действуют независимо; отказ провайдера, в том числе HTTP 429, преобразуется
в безопасный `503 upstream_unavailable`. Автоматических повторов нет.

До upstream атомарно проверяется requestId и сохраняются digest, UTC bucket,
admission timestamp и reservation для учёта. Некорректные запросы и повторы не создают
новый расход. Новая принятая попытка учитывается даже при ошибке.

Профиль выбирается при startup через `WISP_AI_PROVIDER` и `WISP_AI_MODEL`; Groq — default.
Gemini выполняет точный модельный preflight через countTokens для полного generation
payload; Groq и OpenAI используют документированную консервативную оценку. Bounded preflight
и единственный generation inference используют тот же provider/client и исходный
deadline; дополнительных generation/retry нет. Count HTTP failure/overflow до generation
имеет нулевой inference usage; поздний count после cancel не запускает generation.
Точный алгоритм и пределы — [provider budget](../../backend/docs/CONTEXT_PROMPT_ENGINE.md#бюджет-и-ошибка).
Контекст для count передаётся тому же провайдеру на тех же условиях §6; totalTokens
не заменяет фактический usage генерации в ledger.

Один процесс использует один provider без автоматического fallback. Ключи разделены;
неизвестные и конфликтующие профили отклоняются. Параметры — в
[.env.example](../../backend/.env.example); process environment имеет приоритет над файлом.
Custom base URL допускает только HTTPS либо HTTP loopback без userinfo/query/fragment;
выбранный endpoint получает ключ и контекст, поэтому применяются условия §6.
Пределы размера ввода/ответа, deadlines, TLS verification и validation сохраняются.

Reservation — оценка неизвестного расхода, а не условие допуска или лимит вызова:
131072 для Groq, 1114112 для Gemini и 1050000 для OpenAI. Она хранится в каждой записи; восстановление
после сбоя и позднее уточнение используют исходное значение при смене провайдера.
Таблицы и накопленный учёт сохраняются. Старый флаг `halt` не блокирует admission.

Валидный usage содержит неотрицательные целые prompt/completion/total с проверкой суммы.
Он заменяет reservation фактическим расходом, даже если превышает оценку; новые
обращения не блокируются. Gemini включает thoughtsTokenCount в completion вместе
с candidatesTokenCount; отсутствующие thoughts считаются нулём. Некорректный текст
модели не отменяет известный расход. При timeout, disconnect, crash или неизвестном
usage сохраняется uncertain-оценка; она не означает подтверждённую оплату провайдеру.

Завершение учитывается один раз в UTC bucket исходного admission; late usage может
уточнить uncertain один раз. Restart не обнуляет счётчики и переводит незавершённые
записи в uncertain. Ошибка записи не разрешает повторный upstream. Backward clock
не переносит новый учёт в более ранний bucket; deadlines используют монотонное время.

### Повтор requestId

Digest включает method + path и SHA-256 точных принятых UTF-8 body bytes; перестановка ключей/пробелов считается другим body. Сначала полная wire validation, затем duplicate check. Один ID хранится в общем namespace всех endpoints 24 h от admission независимо от окончания UTC-суток. Тот же ID на другом endpoint всегда даёт `request_conflict`. Исторический body-only digest допустим для совместимости только на `/v1/chat`; его нельзя использовать для replay на touch/v2/v3, старые записи сохраняют TTL:

| Состояние ID | Тот же body | Другой body |
|---|---|---|
| In-flight | 409 `request_in_progress`, без нового вызова | 409 `request_conflict` |
| Terminal, ответ ещё в RAM cache | Повтор того же HTTP status/body, без нового учёта | 409 `request_conflict` |
| Terminal, cache истёк/утрачен при restart; uncertain | 409 `request_conflict`, без нового вызова | 409 `request_conflict` |
| Запись старше 24 h и удалена | Обычный новый admission | Обычный новый admission |

Terminal cache — до 10 min, максимум 100 ответов (по 16 KiB), только RAM; eviction допустим и переводит ID в третью строку. Persisted ledger не содержит запросы/ответы. Это bounded at-most-once dispatch в пределах ledger TTL, не exactly-once выполнение модели и не обещание replay после restart. Desktop по-прежнему не повторяет автоматически; ручная новая отправка получает новый UUID. Узнавание ID не даёт доступа к иной истории или чтению ledger.

### Deadline и cancellation

Общий серверный deadline — 10 s от входа в chat endpoint любой версии или `/v1/touch`, включая body/admission/upstream; body должен завершиться за 2 s, иначе 400 `invalid_request`, upstream не вызывается. Для `/v3/events` действуют более короткие [2.5 s / 0.5 s](AI_EVENTS_CONTRACT.md#5-явный-wire-v3-и-данные). Upstream получает остаток общего deadline; connect/pool timeout не выше 3 s и остатка. Исчерпание общего deadline после приёма body → 504 `upstream_timeout`; byte caps проверяются при чтении, не после полной загрузки.

Disconnect/shutdown отменяет upstream task и закрывает HTTP response stream, terminal ledger settlement выполняется независимо от доставки ответа клиенту. Физическая остановка вычисления/списания у provider не гарантируется. Late success не заменяет уже terminal timeout/cancel и не запускает второй вызов; достоверный usage может уточнить uncertain charge не более одного раза. Desktop сохраняет собственные 12 s transport/15 s runtime deadlines и generation guards.

## 6. Данные, сроки хранения и удаление

| Данные | Source of truth / размещение | Retention и удаление |
|---|---|---|
| Личность, отношения, индивидуальная история | Desktop SQLite | По локальной memory policy; server storage отсутствует |
| Ограниченные messages и character projection v1; touch event без истории | Текущий запрос; RAM backend и выбранный provider | Backend освобождает после terminal; не пишет в SQLite, логи, traces/APM или exception dump |
| Terminal response cache | RAM backend, производная копия | ≤10 min или restart/eviction; не резервируется на диск |
| ID/digest/status/timestamps/request count/token usage | Backend SQLite, оператор deployment | ID-записи ≤24 h; дневные aggregates без IDs ≤30 суток; cleanup при startup и не реже минуты, expired записи не используются уже с TTL boundary |
| Диагностика без body/character/credentials/IP | Backend logs, оператор | Status/code, длительность, агрегированные counters ≤7 суток; logging payload и provider error body запрещён |

Ledger-файлы не попадают в обычные backups alpha; при удалении строк очищаются SQLite pages/WAL в обслуживании. Оператор может удалить cache/ledger/logs deployment; это не удаляет provider metadata и не должно использоваться как штатный сброс бюджета. Локальный memory reset не отправляет deletion request: такого endpoint в v1 нет, он не отменяет уже переданное и временный response cache.

Для Groq alpha используется только inference endpoint, без batch/fine-tuning/файлов. До передачи данных внешних тестеров оператор включает **ZDR** в Data Controls и фиксирует проверку; без неё допустимы только синтетические тестовые данные. По [политике Groq](https://console.groq.com/docs/your-data) от 2026-09-18 без ZDR возможны reliability/abuse logs inputs/outputs до 30 дней (дольше при юридической необходимости); usage metadata сохраняется отдельно, точный срок документацией не указан. ZDR относится к customer content, не обещает удаление metadata. Регион и договорные условия провайдера проверяются перед открытием доступа; нельзя объявлять удалённой провайдерскую копию по локальному reset.

Gemini использует только text generateContent через server-owned endpoint, без tools/files/batch и без ослабления safety settings. По [условиям Google](https://ai.google.dev/gemini-api/terms) unpaid service может использовать содержимое для улучшения продуктов и human review; paid service не использует prompts/responses для этого, но не означает ZDR. [Abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies) предусматривает хранение prompts/context/output 55 дней (проверено 2026-10-13). Поэтому текущий Gemini rollout допускает только синтетические данные. Перед внешними тестерами оператор отдельно подтверждает paid-service режим, доступный регион, допустимость retention и информирование пользователей; Groq ZDR не распространяется на Google. Локальный reset не удаляет provider copy; немедленное удаление этой интеграцией не поддерживается.

OpenAI получает тот же разрешённый текстовый контекст через server-owned Chat Completions,
без tools/files/batch; каждый запрос задаёт `store=false`. По [Data controls](https://developers.openai.com/api/docs/guides/your-data)
данные API не используются для обучения без явного opt-in; abuse monitoring logs могут
сохраняться до 30 дней, дольше при юридической необходимости. `store=false` не означает
ZDR: этот режим отдельно согласуется с провайдером. Перед внешними тестерами оператор
подтверждает регион, допустимость retention и информирование пользователей.
Backend не отправляет запросы удаления в OpenAI; локальный reset не удаляет provider copy.
