# ARCHITECT RESULT — P15-A02

**TASK:** [#55](https://github.com/zyzycode/project_wisp/issues/55), 2026-09-18: явные знания, bounded recall и постепенная адаптация без embeddings. Prerequisites: принятые #21/#52. Независимое review временно исключено пользователем; обязательные проверки реализации сохраняются. Ручная Windows-приёмка передана пользователю.

## Decision

Использовать существующую SQLite schema v1: пять явных scalar facts, последние50 пар диалога и20 сохранённых игровых эпизодов дают минимальную индивидуальную память. Local recognizer проверяет буквальный источник; LLM-кандидат не получает право писать произвольное знание/числовое состояние. Семантический порт расширяется optional memory projection, сетевой протокол — отдельным `/v2/chat`; v1 продолжает работать без изменений. Адаптация остаётся чистой Domain логикой с ограниченной частотой/шагом; новые таблицы, embeddings и дополнительные LLM calls не нужны.

Компромиссы: ограниченная грамматика explicit facts сознательно пропускает свободные формулировки; episodic recall не ищет бесконечную историю. Неподдержанная реплика всё равно участвует в текущем разговоре и сохраняется в исходном transcript. Будущий recall index можно подключить к объявленному порту без удаления источников; broad semantic extraction потребует отдельной доказуемой acceptance policy.

## Layer boundaries & Contracts

- [Memory §9](MEMORY_ENGINE.md#9-p15-a02-явные-знания-и-простой-recall) — canonical registry, evidence/correction, local write ordering, query/ranking/budgets и reset. §1–8/schema_v1/writer/worker snapshot semantics #6–#8 сохранены.
- [memory-knowledge.interface.ts](../../src/application/ports/memory-knowledge.interface.ts) — source candidates, bounded semantic context, recall consumer port, отдельный game reader и verified preference evidence. Additive game reader согласован с разработчиком памяти; #56 добавляет read существующей rowid table, без migration.
- [ai-provider.interface.ts](../../src/application/ports/ai-provider.interface.ts) — optional memoryContext/memoryCandidates. Application собирает/проверяет semantic данные; Infrastructure делает независимую wire projection. Runtime validator должен принять новые semantic поля только с проверкой; mapper не превращает candidates в behavior.
- [BACKEND_MEMORY_CONTRACT](BACKEND_MEMORY_CONTRACT.md), [wire v2 types](../../src/application/ports/backend-memory-contract.ts) и [три v2 fixtures](../contracts/fixtures/desktop-backend-v2/) — обе стороны расширения. v1 DTO/fixtures не изменены; серверный BE-I01/#53 продолжает свой согласованный v1 scope.
- [Character §9](CHARACTER_ENGINE.md#9-taste--preferences-вкусы-и-предпочтения) — проверенные источники, separate5min gates, размер шага/caps, отсутствие модели в numerical authority. [§3](CHARACTER_ENGINE.md#3-relationship-система-отношений) отдельно уточняет историческую loveUnlocked latch и current consent.

## Implementation consequences

### #56 — individual memory в диалоге

Обязательные источники: весь этот результат, [Memory §9](MEMORY_ENGINE.md#9-p15-a02-явные-знания-и-простой-recall), существующие §2/§3/§6 только для storage/generation/reset, [Backend v2 §1–5](BACKEND_MEMORY_CONTRACT.md), [AI Provider](AI_PROVIDER_CONTRACT.md#desktop--backend-v1) для lifecycle. Не читать/переписывать всю memory subsystem заново.

1. Prerequisites runtime: #7/#8 для persistence hooks/restore/reset; #54 для сетевого adapter/policy. Объявить read operation и adapter `IGameEpisodeReader.getRecent` в существующем worker transport, query с LIMIT1..20 newest-first по rowid; не менять writer/schema migration1.
2. Реализовать deterministic recognizer/registry, локальный recall и explicit bounded context projection. Повторно использовать facts/history ports; game read нужен обязательно, чтобы после restart вспомнить подходящую реальную игру. Source IDs остаются локальными.
3. Включать semantic memory fields в явно выбранном v2 mode. Обновить exact semantic response validation и adapter selection/response validation; v1 продолжает прежнюю shape и не делает fallback на v2/обратный. Любая network failure сохраняет локальную жизнь/память.
4. Использовать #7 terminal hook: appendTurn acknowledgement → current generation check → fact upsert → optional verified evidence callback #57. Provider reply не ждёт storage и не обещает durable write. Idempotency исходной пары/факта, once-only callback и отсутствие startup re-extraction обязательны. Schema v1 и snapshot v1 не менять.
5. Перед новым turn ограничить recall200ms с текущей generation; source error/timeout → пустая память на этот turn, без unbounded backlog/второго LLM. Character snapshot всегда доступен. Удалять ranked episodes при превышении budget, а не ядро/facts.
6. Tests: first fact → restart recall; correction старого имени → новый факт без конкурирующего старого episode; temporary role/цитата/отрицание/модельный вымысел → no write; отсутствие candidate при поддержанном local statement; failure append → no fact; failed fact не отменяет reply; game after restart → actual outcome; TTL-free local storage vs bounded query; reset/dispose after каждого await; byte/UTF-16/ranking ties; v1 regression и v2 fixtures.

Client work на mocked v2 может выполняться параллельно server v2. Кодовый gate — совместимые validators/fixtures на обеих сторонах и `npm run typecheck` → `npm test`; build не запускать. Живой provider/endpoint не блокирует этот code gate: подключение сервиса — внешнее операторское условие, ручные Windows сценарии — пользователь.

### #57 — bounded Character learning и consent regression

Prerequisite #56 для verified persisted preference signal; #8 snapshot уже хранит axes/preferences. Обязательные источники: Character §3/§5/§9, `personality-plasticity.ts`, `preferences.ts`, `stimuli-reducer.ts`, существующий `CharacterStateService`; Memory §9 только для evidence semantics.

- Сначала падающие регрессии существующего дефекта: friendship>=400/no current consent не разрешает новый unlock; positive love growth при false consent запрещён. Исправить только этот gate. Историческое true/noConsent состояние принимается restore, прошлое love не стирается, `canExpressFlirt` продолжает проверять current consent. Не менять другие rewards/thresholds.
- Добавить чистые Domain правила5min axes gate и отдельного5min preference-learning gate с явными now/state; Character service хранит transient gates, startup/reset delays предотвращают ускорение через restart. Immediate Needs/physics сохраняются; provider_response не даёт второй axes reward за user send.
- Из verified current persisted `user.cursor_game` получать только like/dislike evidence, ID дедуплировать; maximum2 affinity units/sample, confidence по формуле; остальные user facts/роль не переписывают preferences/traits/consent. Объявленный `ICharacterPreferenceLearning` реализует Application service, семантика вычисления — Domain.
- Сохранять через текущий checkpoint, не новую таблицу/timer/IPC. Память не воспроизводит опыт после restart. Tests: gate boundary, distinct evidence/cooldown, hard/soft caps, single wish vs6 spaced samples, mixed/dislike reversal, reset/late callback, restart preservation, no new model numeric authority. Typecheck → npm test; build запрещён.

### Связанная server implementation — v2 memory context

Отдельная задача в **существующем `wisp_backend`**, зависимая от BE-I01 (server #1 / desktop #53) и этого gate. Scope: `wisp_backend/api/`, `schemas.py` либо отдельный v2 schema module, service/provider internal result, prompts, existing admission ledger namespace, `tests/fixtures/desktop-backend-v2/`, backend docs/README. Существующие Python/FastAPI/httpx/Groq/stdlb sqlite3 и dependency snapshot сохраняются; новой зависимости не требуется.

1. Добавить `/v2/chat` рядом с v1 и strict bounded validators, отдельный versioned envelope/error responses. Внутренние prompt/model reply структуры получают memory/candidates без распространения wire DTO в local domain. Request v1 не начинает принимать memory.
2. Один Groq call формирует reply и optional candidates; memory — untrusted prompt section с precedence/grounding правилами. Удерживать usage даже при malformed candidates/text согласно существующему ledger, не делать второй extraction/retry.
3. Общие rate/concurrency/day counters между v1/v2; idempotency digest включает endpoint, версия не даёт новый бюджет. Legacy v1 records сохраняют TTL, mixed ID/version → conflict. Existing timeout/disconnect/uncertain/replay semantics сохраняются.
4. Скопировать v2 fixtures побайтово и оставить v1 tests; проверить обе версии, malformed/duplicate candidates, wrong evidenceQuote, unknown fields, caps, endpoint conflict, outage/deadline/late settlement и отсутствие payload logs. Обновить разрешённый состав передачи/retention docs ссылкой на v2 §4, без server user-memory persistence.
5. Gate: `python -m pip check` + `python -m pytest -q` в закреплённом venv и mocked cross-contract проверка общих fixtures; live provider/deployment не входят в code gate. Private access/ZDR сохраняются условиями внешнего тестирования, оператор проверяет их отдельно. Отсутствие подключённого live endpoint не блокирует закрытие кодовых задач и локальную память/v1.

## VERIFICATION

**PASS:** `npm run typecheck`, локальные file links, согласованность requestId/evidenceQuote и byte caps трёх JSON fixtures, лимит450 строк, `git diff --check`. Исходные SHA-256 всех v1 fixtures сохранены. `npm test`/build — NOT RUN по роли. Runtime/SQL/worker реализации не добавлены; v2 fixtures — новый контракт, не доказательство работающего endpoint.

**CHANGES:** canonical Memory/Character/AI contracts, wire v2 specification/types/fixtures, Application knowledge ports и этот результат. **BOUNDARIES:** schema_v1/snapshot/worker writes/v1 wire неизменны; backend в отдельном проекте. **SPRITES:** none. **RECOMMENDED NEXT GATE:** app-developer #56, затем #57; server v2 — параллельная связанная реализация после BE-I01.
