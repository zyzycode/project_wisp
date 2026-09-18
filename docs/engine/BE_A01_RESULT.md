# BE-A01 — аудит существующего backend и gate реализации

**TASK:** [#52](https://github.com/zyzycode/project_wisp/issues/52), 2026-09-18. Проверен [wisp_backend commit 275cc8161e5f725681fdacc725708acaf74784b6](https://github.com/zyzycode/wisp_backend/tree/275cc8161e5f725681fdacc725708acaf74784b6). Это архитектурный gate закрытой alpha; работающий deployment, качество живой модели и публичный выпуск им не подтверждаются.

## Decision

Сохранить Python/FastAPI, Pydantic validation, httpx и Groq: существующая реализация совместима с базовым desktop wire v1 и уже имеет проверяемые границы. Достроить admission/учёт, bounded dedup, cancellation и общие fixtures в том же репозитории; durable ledger реализовать стандартным Python `sqlite3` без нового сервера БД/пакета. Начальный допуск — закрытая сеть, общие бюджеты deployment; application auth, аккаунты, memories и инициативы не добавлять неявно в v1. Постоянные правила находятся только в [BACKEND_API_CONTRACT §5–6](BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы).

Выбор консервативной reservation полного model context сознательно снижает доступность при неизвестном usage, зато не требует оценки токенов «на глаз» или tokenizer-зависимости. Точный tokenizer/менее консервативный резерв — последующая оптимизация после измерений, не условие реализации gate.

## Проверенное состояние и разрывы

Ссылки на код закреплены на проверенном commit; наличие tests отделено от ещё не проверенного поведения.

| Область | Что реально есть | Что требуется до alpha |
|---|---|---|
| Wire/schema | [schemas.py](https://github.com/zyzycode/wisp_backend/blob/275cc8161e5f725681fdacc725708acaf74784b6/wisp_backend/schemas.py): strict поля/enums/numbers/booleans, UUID v4, порядок 1–7 messages, UTF-16 limits, optional boredom, malformed decision → text-only | Сохранить формы; port/IPC delta не нужен |
| HTTP/bytes | [boundary.py](https://github.com/zyzycode/wisp_backend/blob/275cc8161e5f725681fdacc725708acaf74784b6/wisp_backend/api/boundary.py), [chat.py](https://github.com/zyzycode/wisp_backend/blob/275cc8161e5f725681fdacc725708acaf74784b6/wisp_backend/api/chat.py): 32 KiB request, 16 KiB response, strict JSON, запрет compressed request | Ограничить время body read и общий deadline; отключение клиента после body сейчас отдельно не обрабатывается |
| Provider boundary | [groq.py](https://github.com/zyzycode/wisp_backend/blob/275cc8161e5f725681fdacc725708acaf74784b6/wisp_backend/providers/groq.py): no redirects, bounded 256 KiB upstream, JSON model reply, safe errors, один upstream | Usage сейчас отбрасывается: внутренний provider result должен передавать confirmed usage даже при невалидном model text |
| Prompt/model ownership | [prompts.py](https://github.com/zyzycode/wisp_backend/blob/275cc8161e5f725681fdacc725708acaf74784b6/wisp_backend/prompts.py): system prompt серверный; character как untrusted user context; модель не получает requestId; default text-only | Сохранить; text-only разрешён, поведение/личность не переносить на сервер |
| Lifecycle | [service.py](https://github.com/zyzycode/wisp_backend/blob/275cc8161e5f725681fdacc725708acaf74784b6/wisp_backend/service.py): 10 s вокруг provider; [application.py](https://github.com/zyzycode/wisp_backend/blob/275cc8161e5f725681fdacc725708acaf74784b6/wisp_backend/application.py): lifespan-owned client | Deadline от входа запроса, cancellation/disconnect/late terminal settlement по §5 |
| Admission/budget | Есть только коды 409/429 в schemas/errors | Ledger, atomic reservation, usage accounting, global rate/concurrency/day caps, restart recovery отсутствуют |
| Idempotency | ID используется для ответа, без ledger/cache | Реализовать таблицу повторов §5; exactly-once provider execution не обещать |
| Access/data | [main.py](https://github.com/zyzycode/wisp_backend/blob/275cc8161e5f725681fdacc725708acaf74784b6/main.py) по умолчанию слушает loopback; application auth отсутствует; backend сам не пишет историю | Конфигурация частного ingress/ZDR, retention cleanup и запрет payload logging на всей цепочке ещё не подтверждены |
| Fixtures/docs | Только `tests/fixtures/request.local.json`, без boredom; copied server contract содержит неработающие desktop-relative links | Перенести три точных fixture-файла, сверять byte hashes; обновить серверную копию контракта и ссылки |
| Tests | 88 существующих Python tests проходят с mocked upstream; проверяют ranges, errors, deadline, закрытие stream, lifecycle/OpenAPI | Нет общих fixture integration, ledger/duplicate/concurrency/restart/UTC, downstream-disconnect и bounded-body-time tests |
| Tooling | Python 3.10+, requirements ranges, pytest; собственных AGENTS/CI/lock в проверенном дереве нет | Зафиксировать проверенный dependency snapshot и инженерные правила в серверной задаче; live credentials в tests запрещены |

## Layer boundaries & Contracts

- Desktop [wire DTO](../../src/application/ports/backend-ai-contract.ts) и три [fixtures](BACKEND_API_CONTRACT.md#4-общие-json-fixtures) сохраняются побайтово. Ни server-only budgets, ни network access не добавляют поля в request/response. Error dictionary уже достаточен.
- Backend API layer владеет bounded input/schema и HTTP/error mapping; service — admission, ledger settlement и provider lifecycle; provider adapter — Groq payload/usage/error translation; ledger — внутренний `sqlite3` adapter. До реализации объявить соответствующий внутренний provider result/ledger interfaces в серверном Python-проекте, не в desktop Application.
- Server wire schema отделена от model reply и от внутренних usage/ledger типов. Provider сохраняет safe usage независимо от успешности model reply; service не читает raw provider response.
- [AI_PROVIDER_CONTRACT: Desktop ↔ backend v1](AI_PROVIDER_CONTRACT.md#desktop--backend-v1) остаётся владельцем desktop admission, 12/15 s timeout, fallback, current generation и no-retry. Уточнена только partial mapping: valid wire mood `playful` опускается в semantic DTO, поскольку точного local mood нет.
- Memory source of truth остаётся desktop SQLite. Сервер не управляет Character/FSM/Motion и не сохраняет индивидуальную память. Расширения memory/event API — отдельные #55/#58.

## Implementation consequences

### #53 — доработка существующего wisp_backend

Обязательные источники: весь этот результат, [wire §1–6](BACKEND_API_CONTRACT.md), серверные `schemas.py`, `api/boundary.py`, `service.py`, `providers/base.py`, `providers/groq.py`, `config.py` и соответствующие tests. Не требуется читать все engine specs desktop.

1. Работать в отдельном `wisp_backend`: `wisp_backend/`, `tests/`, `docs/`, README, существующие requirements/pytest tooling. Разрешён `AGENTS.md` для явно недостающих серверных правил по этой интеграционной задаче; runtime state — за пределами tracked source. Никакого server runtime в desktop `src/`.
2. Ввести внутренние contracts usage/result/admission/ledger, затем реализацию §5. Scope — один worker; lock+transaction для reservation/terminal settlement, `sqlite3` I/O вне event loop. Путь ledger берётся из server config; rollback/ошибка диска закрывает admission. Не добавлять ORM/Redis/Groq SDK.
3. Добавить bounded body/overall deadline и disconnect/shutdown cancellation; full/uncertain charge ровно один раз, release capacity в `finally`. Удержание reservation при неизвестном outcome обязательно. Секреты/модель/политика читаются только server config; неподдерживаемый профиль/лимиты — startup error.
4. Скопировать без изменения три desktop JSON fixtures в `tests/fixtures/desktop-backend-v1/`; success проверять через реальный route с mocked provider, error через 503 route outcome. Сверка SHA-256 ниже — дополнительная защита от drift, не замена HTTP tests. Существующий local fixture можно сохранить для границ optional boredom.
5. Зафиксировать зависимости воспроизводимо (включая transitives), сохранить текущие библиотеки; выбрать версии после compatibility/security проверки, не слепо объявлять широкий range production-ready. Новая библиотека требует отдельного обоснования. Проверенный аудит snapshot — evidence совместимости, не vulnerability attestation.
6. Обновить серверные docs/README: canonical desktop links, operator settings, один worker без reload при тестовом допуске, private ingress, ZDR verification, retention/cleanup/recovery. Не публиковать endpoint и не покупать сервисы в рамках реализации.

Серверные обязательные проверки: `python -m pip check`, `python -m pytest -q` в изолированном venv с exact dependency snapshot. Bugfix начинается с регрессии. Использовать mocked httpx transport и управляемые clock/provider; не реальные LLM calls. Матрица дополнений:

- одновременный одинаковый ID → один upstream; другой body → 409; replay/TTL/eviction/restart → согласованная таблица;
- атомарные cap boundaries, reservation/refund, missing/malformed/over-limit usage, midnight, backward clock, crash/in-flight recovery, disk unavailable;
- provider outage/invalid output/timeout, медленный body, disconnect/shutdown, late result, освобождение slot, отсутствие повторов/утечек payload;
- byte-identical fixtures и HTTP error/status mapping, cleanup TTL и отсутствие content на диске/в logs.

На дату аудита Issues в `wisp_backend` отсутствуют; новые серверные implementation задачи и их связь с desktop #53 оформляет координатор/менеджер. Этот gate не меняет GitHub статусы.

### #54 — desktop adapter и локальная policy

Обязательные источники: весь этот результат; [AI Provider: Desktop ↔ backend v1](AI_PROVIDER_CONTRACT.md#desktop--backend-v1), [wire §1–4](BACKEND_API_CONTRACT.md), §5 только для error semantics и ограничения alpha access. Backend implementation не является prerequisite разработки adapter на mocked transport.

- Реализовать explicit snapshot projection/exact validation, bounded response reading, aborting transport, Main DI/config, локальные minute/session/cooldown guards. Без URL использовать Mock; configured unavailable backend не обходить прямым LLM.
- Public wire/IPC расширение не нужно. 409/429 соответствуют согласованным errors; нет auto-retry/replay UI, нет подсчёта server tokens в Renderer. Wire-valid `playful` mood опускается без потери valid behavior/text.
- Проверки: shared fixtures, несовпадающий ID/version/status, malformed/oversize/hints, abort/late/reset/dispose, cooldown и cap boundaries, отсутствие network в Renderer. Финальные desktop gates: typecheck → npm test; build запрещён.
- Реальное HTTPS/offline/timeout smoke и ненарушенный drag/cursor на Windows остаются интеграционной приёмкой после поставки endpoint; mocked tests не заменяют её.

## VERIFICATION

- Backend commit выше: **88 tests passed**, `pip check` passed; реальные Groq calls не выполнялись. TestClient потребовал запуск вне ограниченного sandbox; runtime-код не менялся.
- Audit environment: Python 3.10; FastAPI 0.141.1, Uvicorn 0.53.0, httpx 0.28.1, python-dotenv 1.2.3, Pydantic 2.13.5, Starlette 1.6.0, pytest 9.1.1. Два deprecation warnings Starlette/httpx/AnyIO: отслеживать при фиксации зависимостей, не вводить новый httpx2 только ради подавления warnings.
- Все три исходных desktop fixtures успешно валидированы реальными Python schemas. Перенос в server regression suite и новые policy tests **ещё не выполнены**.
- SHA-256: request.valid `64f6c769e91146c0311b0a15939760cfecba14eb39ce8df2e57a4f1ffff354e5`; response.success `f1c50137b48fed57b34459eb9932cbc016bc80e94b9677bac507c407206962ae`; response.error `f0db527096694ccacd6b0683361dcd957e2cd598e040617cad3c0a9cc86a093e`.
- Desktop изменения docs-only: ссылки, согласованность, лимит ≤450 строк и diff проверены. Typecheck/npm test/build не запускались; новые ports/DTO не объявлялись.
- **CHANGES:** этот результат, canonical backend policy и уточнения AI Provider. **BOUNDARIES:** без server/runtime реализации, секретов, deployment и правок памяти. **SPRITES:** none.
- **RECOMMENDED NEXT GATE:** app-developer, #53 и #54 параллельно; независимое review временно исключено прямым указанием пользователя. Production/public access остаётся за пределами gate; проверка private ingress/ZDR и live Windows smoke необходима перед внешней alpha.
