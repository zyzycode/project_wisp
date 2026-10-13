# ARCHITECT RESULT — BE-A02

**TASK:** [#61](https://github.com/zyzycode/project_wisp/issues/61), 2026-10-13. Архитектурная сверка восстановления backend в монорепозитории; implementation — [#62](https://github.com/zyzycode/project_wisp/issues/62), [#63](https://github.com/zyzycode/project_wisp/issues/63), [#64](https://github.com/zyzycode/project_wisp/issues/64).

## Decision

Перенести пригодную историческую реализацию последовательными slices safeguards → v2 → v3, адаптируя её к текущим touch и proxy/TLS исправлениям. Сохранить Python/FastAPI/Pydantic/httpx/Groq и принятый служебный SQLite ledger; переписывание сервера или новая зависимость не требуется. Все пять AI endpoints используют один admission и namespace requestId; локальная память и причинность событий остаются desktop. Готовность исходной ветки не заменяет проверки перенесённого кода.

## Закреплённые источники и матрица

Проверен через GitHub API исходный HEAD [3101c96167776ddbc08fc8c6434a8bb615e2ba35](https://github.com/zyzycode/wisp_backend/tree/3101c96167776ddbc08fc8c6434a8bb615e2ba35), ветка `codex/memory-ai-mvp-20260918`. Последний runtime commit — [7065dd83d4c06abdebfb2c8e24e6d2af0112ec8f](https://github.com/zyzycode/wisp_backend/commit/7065dd83d4c06abdebfb2c8e24e6d2af0112ec8f); HEAD меняет только ссылки документации. Предыдущие slices: [5d749587a5893908b2d51d5e09d94d7e4bdfe707](https://github.com/zyzycode/wisp_backend/commit/5d749587a5893908b2d51d5e09d94d7e4bdfe707) — safeguards, [af21c36cb79fb1e54294c57b40a50bbb44c0f369](https://github.com/zyzycode/wisp_backend/commit/af21c36cb79fb1e54294c57b40a50bbb44c0f369) — v2. База исторической ветки — `275cc8161e5f725681fdacc725708acaf74784b6`, она же исходный импорт монорепозитория. Сверка текущего дерева выполнена на `596d8e9`; локальный соседний `wisp_backend` всё ещё содержит старую базу и не является источником поздней поставки.

| Область | Пригодная исходная реализация | Расхождение / решение |
|---|---|---|
| Ledger / учёт | `contracts.py`, `ledger.py`: atomic SQLite admission вне event loop, reservation, confirmed/uncertain usage, restart/UTC/TTL, bounded cache | В текущем backend отсутствует. Переносить, сохраняя позднюю защиту cache от deadline/cancellation из runtime HEAD; не откатывать её при последовательном переносе |
| Service / HTTP | `service.py`, `api/boundary.py`, `api/chat.py`, `application.py`: общий deadline, disconnect watcher, independent settlement, shutdown | Источник не знает touch. Включить `/v1/touch` в route policy и общий service до признания #62 завершённой |
| Namespace | Источник v2/v3 включает method+path в digest, поддерживает legacy body-only ID | Историческая проверка `version == 1` для legacy digest должна стать exact `/v1/chat`: touch тоже version1, но не legacy chat |
| Provider | `ProviderResult`, `Usage`, bounded Groq stream, usage до model validation | Сохранить внутренний result; touch не должен терять usage на невалидном тексте и не должен проходить через chat hint sanitization |
| Touch | Текущие `touch.py`, общий request fixture, четыре variant, короткий текст | Сохранить wire/prompt/route. Сейчас handler напрямую вызывает provider; `ModelReply` может удалить невалидный decision до touch validation. В #62 нужен strict text-only model result до любой chat sanitization |
| Proxy / TLS | Текущие `config.py`, `upstream.py`, `test_upstream_environment.py` | В историческом config нет `upstream_trust_env`. Сохранить default false, явный `WISP_UPSTREAM_TRUST_ENV`, TLS verification и no redirects |
| v2 | `memory_schemas.py`, `api/memory.py`, prompts/provider context, memory tests | Пригодны для переноса в #63: текущие frontend wire types и shared fixtures совместимы; серверной пользовательской памяти нет |
| v3 | `events_schemas.py`, `event_prompts.py`, `api/events.py`, v3 chat bridge, lifecycle regression | Пригодны для #64: short event deadline/output cap, actual outcome, previousInitiative, общий ledger. Touch остаётся самостоятельным v1 mode |
| Fixtures / docs | 12 исходных shared v1/v2/v3 fixtures совпадают с Git blobs монорепозитория | Читать из `docs/contracts/fixtures/`, не переносить исторические копии в tests. Дополнительно сохраняется нынешний `request.touch.json`; старые зеркала контрактов/инструкции не копировать |
| Dependencies / config | Исходная ветка закрепляла exact runtime/dev snapshot; текущие requirements используют ranges | Для переноса новые packages/изменение requirements не нужны. Исторические pins не являются разрешением менять текущее окружение или заявлять его security attestation; автоматический import requirements исключён |

## Layer boundaries & Contracts

- [Backend API §3, §5–6](../../docs/contracts/BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы) владеет errors, общим admission всех endpoints, endpoint-aware ID, deadlines и служебными данными. В нём уточнены touch и безопасная совместимость legacy digest.
- [Memory §1–5](../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#1-версия-и-границы) владеет существующим v2, selected context и proposals. [Events §5, §7–8](../../docs/contracts/AI_EVENTS_CONTRACT.md#5-явный-wire-v3-и-данные) владеет v3 и отдельным touch; strict text-only правило touch теперь явно применяется к сырому model result.
- API boundary валидирует route/version/body и отслеживает disconnect; service владеет admission, once-only settlement и shutdown; provider отдаёт только внутренний result/usage; ledger хранит служебный учёт, не пользовательскую память. Python schemas и desktop wire types проверяются независимо, без взаимных imports.
- Внутренние `Usage`, `ProviderResult`, `Outcome`, `Admission`, `Ledger` и reply context брать из исходных `contracts.py`/`providers/base.py`, адаптируя version/mode по шагам. В #62 добавить отдельный touch reply mode/schema; не импортировать v2/v3 modules до соответствующего slice. Desktop ports/IPC и wire fixtures не меняются.
- Ранее принятые [BE-A01](../../docs/archive/BE_A01_RESULT.md), [P15-A02](../../docs/archive/P15_A02_RESULT.md) и [P17-A04](../../docs/archive/P17_A04_RESULT.md) остаются основаниями поведения. Их исторические пути отдельного репозитория/копирования fixtures заменены размещением монорепозитория и последствиями ниже. Будущие расширения памяти не входят в перенос v1/v2/v3.

## Implementation consequences

Весь этот результат обязателен для каждого исполнителя. Исторические результаты являются evidence поставки, а текущие canonical contracts — требованиями; не копировать целиком исторический checkout поверх нынешнего backend. Ниже пути runtime/test/config указаны относительно `backend/`; общие fixtures находятся в корневом `docs/contracts/fixtures/`.

### #62 — safeguards и сохранение touch

Обязательные источники: [Backend API §1–6](../../docs/contracts/BACKEND_API_CONTRACT.md), [Events §8](../../docs/contracts/AI_EVENTS_CONTRACT.md#8-явное-касание-v1), исходный safeguards commit и поздние lifecycle/cache исправления `7065dd8` в `service.py`/`ledger.py`. Читать текущие `touch.py`, `config.py`, `upstream.py` и соответствующие tests перед переносом.

Разрешённые runtime файлы: `wisp_backend/contracts.py`, `ledger.py`, `service.py`, `application.py`, `config.py`, `errors.py`, `providers/base.py`, `providers/groq.py`, `api/boundary.py`, `api/chat.py`, `touch.py`; при выделении text-only типов — `touch_schemas.py`. `schemas.py` менять только если требуется существующая форма внутренних errors, без изменения v1 wire. `upstream.py` — только необходимая совместимость lifecycle при сохранении текущих proxy/TLS настроек. Tests: текущие `conftest.py`, config/lifecycle/proxy/environment/touch/shared/OpenAPI tests и исторические admission/ledger/cancellation tests. Документация: отдельная серверная operator-документация в `backend/docs/`; изменение навигатора передать менеджеру.

1. Начать с падающих регрессий текущих gaps: duplicate/cross-route ID вызывает повторный upstream, touch обходит общий бюджет, body/disconnect не ограничивают всю операцию, malformed decision в touch исчезает при chat sanitization. Затем переносить готовые ledger/provider/service механизмы и подключить оба v1 routes.
2. У touch собственная strict model schema `text` ≤240, без decision/candidates/лишних ключей; не использовать `ModelReply` с удалением hints. Сохранить все четыре variant, prompt/locale и existing success wire. Один запрос проходит общий service и учитывает usage даже при 502.
3. Endpoint-aware digest ввести уже в #62, не ждать #63. Legacy fallback только для `/v1/chat`; общий budget/cache/concurrency включают touch. Проверить exact deadline, duplicate/replay/eviction/TTL, restart/UTC/backward clock, disk failure, late admission/settlement/usage и отсутствие позднего success replay после terminal timeout/cancel.
4. В существующем `config.py` разрешены `LedgerSettings`, `ledger_path`, `WISP_LEDGER_PATH`, `WISP_LIMITS_JSON`, проверка рассмотренного model reservation profile и верхних границ timeout/output. Сохранить `WISP_UPSTREAM_TRUST_ENV` и его validation. Runtime ledger по умолчанию — исторический `Path.home() / '.local' / 'state' / 'wisp-backend' / 'ledger.sqlite'`, override — явный server path через `pathlib`; tests используют отдельный `tmp_path`. Не читать и не мигрировать desktop SQLite.
5. `.env.example` разрешено дополнить только ledger path/limits примерами и operator пояснениями, без секретов. `requirements*.txt`, root launchers, package files, pytest tooling, AGENTS/корневые навигаторы не менять: для этого переноса нет необходимой dependency/tooling delta. Не восстанавливать старый test fixture factory без изолированного ledger и mocked usage; сохранять local optional-boredom fixture и нынешние proxy/TLS tests.
6. Проверки: сначала новые/затронутые regression tests, затем `node scripts/wisp.mjs check:backend` → `node scripts/wisp.mjs test:backend`. Обязательны обе v1 формы, shared fixtures, safe errors, timeout/outage/invalid output, shutdown/disconnect/closed stream, fail-closed storage и отсутствие payload в logs/ledger. Не расширять scope после финальных gates.

### #63 — v2 selected memory

Prerequisite: принятое #62. Обязательные источники: [Memory §1–5](../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#1-версия-и-границы), Backend API §3/§5–6 и исходный v2 slice `af21c36`; соответствующие последствия исторического P15-A02 применяются с текущими путями.

Разрешены `wisp_backend/memory_schemas.py`, `api/memory.py`, `prompts.py`, versioned response/provider context в `contracts.py`, `providers/base.py`, `providers/groq.py`, `service.py`, `api/boundary.py`, `application.py`; `ledger.py` — только необходимая совместимость уже общего namespace. Tests — исторические `test_memory_*`, существующие shared/route/lifecycle tests и необходимые mocked integration проверки; backend docs. Requirements/config/tooling delta не требуется.

1. Адаптировать готовые v2 validators/prompts/candidates; v1/touch сохраняют exact shape. Evidence quote проверяется по trim последней user-реплики; duplicate keys/невалидные candidates удаляются по §3, unknown root keys отклоняются. Один provider call, memory только untrusted context, usage не теряется при invalid output.
2. Сохранить единственный ledger/admission из #62. Сверить ошибки envelope2, cross-version/touch conflicts, caps, empty memory, partial hint degradation, cancellation/late result. Читать общие fixtures напрямую; не создавать server copy пользовательского профиля.
3. Для критерия frontend restart использовать существующий клиентский memory adapter/restore test harness с синтетическим persisted fact/game и mocked upstream текущего backend. Не ограничиваться одним POST вручную: доказать, что восстановленный клиентский selected context принят route v2. Если требуется изменить клиентский test harness, сначала согласовать точный integration scope с менеджером; повторная реализация закрытой #56 не нужна.
4. Backend gates как в #62; при интеграции обеих частей дополнительно `node scripts/wisp.mjs typecheck` → `node scripts/wisp.mjs test`. Совместный launcher default v1 не переключать в рамках переноса; тестовая конфигурация явно выбирает v2.

### #64 — v3 events и follow-up chat

Prerequisites: #62 и #63. Обязательные источники: [Events §3–5, §7–8](../../docs/contracts/AI_EVENTS_CONTRACT.md#3-causal-deadlines-quiet-и-игнорирование), Memory §1–5, Backend API §3/§5–6 и исходный runtime HEAD `7065dd8`; соответствующие последствия P17-A04 применяются с текущими путями.

Разрешены `wisp_backend/events_schemas.py`, `event_prompts.py`, `api/events.py`, `prompts.py`, `contracts.py`, `providers/groq.py`, `service.py`, `api/boundary.py`, `application.py`; `ledger.py` только для сохранения поздней cache/deadline защиты. Tests — исторические `test_events_*`, shared/route/lifecycle и необходимые mocked integration проверки; backend docs. Требований к новым requirements/config/tooling нет.

1. Восстановить `/v3/events` (text-only, cap1024, server2.5s/body0.5s) и `/v3/chat` (v2 semantics с optional previousInitiative, server10s/body2s). Touch остаётся v1, со своими variant и прежними deadlines; не выдавать touch за автономный v3 event.
2. Проверить все пять endpoints на общий budget и ID namespace, error version, usage-on-invalid-output, once-only cancel/settlement и late replay regression. Actual outcome остаётся desktop fact; previousInitiative не источник user fact/extraction и не системная инструкция.
3. Шесть v3 fixtures и прежние v1/v2/touch должны проходить; mocked integration game → line → accepted user reply подтверждает previousInitiative без поддельного user message. Quiet/reset/dispose/late response должны сохранять существующее клиентское подавление старых событий. Изменение клиентского harness требует точного integration scope от менеджера; закрытую #59 не реализовывать заново.
4. Backend gates и общая integration проверка как в #63. Не добавлять server scheduler, память пользователя, deployment или переключение launcher default; локальная жизнь продолжает работать при outage.

## Итог

**CHANGES:** уточнены canonical admission/legacy digest/touch model validation и состав служебных данных; зафиксированы исходные commits, пригодные модули, scope/config и последствия #62–64. Runtime, requirements, wire types и fixtures не изменены.

**BOUNDARIES:** только архитектура; одна серверная SQLite БД служебного учёта по ранее принятому gate, без auth/new storage topology/новых packages. Private ingress/ZDR/region/retention оператора, live provider и ручная Windows-приёмка не подтверждены и не являются доказательством code delivery. Исторические 224 pytest — результат прежней поставки, не текущего backend.

**SPRITES:** none.

**VERIFICATION:** PASS — source commits/code сверены через GitHub API; 12 shared v1/v2/v3 fixtures валидированы исходными Pydantic schemas в текущем Python окружении, включая сохранение valid candidates; их Git-blob SHA-256 совпадают с историческими файлами (Windows checkout отличается только CRLF). Текущие v1 chat/success/error/touch schemas принимают все четыре fixtures. Отдельная schema-проверка подтвердила gap touch sanitization; он включён в #62. Ссылки/anchors, согласованность contracts, лимит450 строк и `git diff --check` проверены. Продуктовые tests/typecheck/build — NOT RUN: архитектурная документация, desktop ports/DTO не менялись; provider/network runtime не вызывался.

**RECOMMENDED NEXT GATE:** done для #61; #62 → #63 → #64 — app-developer после принятия менеджером этого результата. Полная серверная поставка монорепозитория остаётся незавершённой до их реализации.
