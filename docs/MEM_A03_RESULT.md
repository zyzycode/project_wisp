# ARCHITECT RESULT — MEM-A03

**TASK:** [#65](https://github.com/zyzycode/project_wisp/issues/65), 2026-10-13; frontend + backend, архитектура важных событий/общих шуток поверх завершённых [#55](https://github.com/zyzycode/project_wisp/issues/55)/[#56](https://github.com/zyzycode/project_wisp/issues/56). Предыдущий [P15-A02 RESULT](archive/P15_A02_RESULT.md) остаётся источником текущего узкого MVP. Этот результат не объявляет новые возможности реализованными.

## Decision

Добавить две явно подтверждаемые пользователем категории локальной памяти и производный bounded lexical index в существующем SQLite worker. Это даёт устойчивый recall значимого события за пределами последних 50 разговорных пар, сохраняя проверяемый источник и локальный контроль исправления/отзыва/удаления. Backend получает только выбранную текущую projection; новые варианты episode требуют отдельного planned `/v4/chat`, поскольку exact-shape v2/v3 не принимают их и пересказ шутки как обычного dialogue скрывал бы её семантику. V4 сохраняет `previousInitiative` из v3, а автономные события продолжают использовать существующий `/v3/events` с прежним bounded контекстом.

Альтернативы: расширение `user_facts` нарушило бы scalar cardinality; поиск только последних пар теряет старое важное событие; автоматический model summary не доказывает авторство/evidence. Embeddings не нужны для первого проверяемого набора exact lexical recall; их возможная польза проверяется по измеренным misses, не по объёму истории самому по себе. Новых зависимостей нет.

## Layer boundaries & Contracts

- [Memory §10](../frontend/docs/engine/MEMORY_ENGINE.md#10-mem-a03-важные-события-и-общие-шутки-planned) — канонические evidence, локальная точка ввода, revisions/forget, additive schema2, lifecycle, recall и quality fixtures. §1–9 продолжают описывать действующую базу.
- [Memory wire §6](contracts/BACKEND_MEMORY_CONTRACT.md#6-mem-a03-planned-расширение-событий-и-шуток) — целевые обе стороны v4, payload budgets, compatibility/retention. §1–5/v2 и [events v3](contracts/AI_EVENTS_CONTRACT.md#5-явный-wire-v3-и-данные) не меняются.
- Domain Character не получает knowledge text, новые rewards или adaptation signals. Application владеет подтверждением/исправлением/recall/generation; Main — typed IPC/DI; Infrastructure — SQLite worker и независимая versioned wire projection; Renderer — карточка/пользовательские команды. Backend — schema validation и untrusted prompt block, не writer локальной БД.
- Текущие [knowledge ports](../frontend/src/application/ports/memory-knowledge.interface.ts), [registry](../frontend/src/application/services/memory-fact-registry.ts), [recall](../frontend/src/application/services/memory-recall.ts) изучены, но не изменены. Целевые новые порты/DTO и fixtures объявляются в первом slice до runtime. Этот docs-only gate не добавляет неиспользуемые future interfaces.

## Implementation consequences

Ниже названия следующих минимальных задач, **не созданные GitHub IDs**. Менеджер создаёт/маршрутизирует их после принятия #65. Весь этот результат и раздел соответствующего slice — обязательные источники; никаких требований читать все engine docs.

### MEM-I01 — local confirmed knowledge

Зависит только от принятого #65 и существующей persistence/IPC базы #56; независим от восстановления backend. Обязательные источники: Memory §10.1–10.3/10.5, §3–4/§6 для worker/generation/reset, действующие `memory-repository.interface.ts` и `memory-ipc-validation.ts`.

1. Сначала объявить confirm/update/withdraw/delete/list ports и typed IPC DTO/guards в существующих Application/Shared границах, включая expected revision, receipt/generation и безопасные ошибки. Добавить локальную карточку у завершённого turn и список сохранённых карточек с page≤20 в существующем диалоге; исправление/отзыв/удаление доступны там же.
2. Затем additive migration2, transactional current evidence/index/suppression/receipts и reset всех новых rows. Сохранение работает offline; cloud ответ/новое окно/provider secret не требуются. При unresolved write/error показать несохранённый результат, не обещать успех по timeout.
3. Все существующие recall/hydration/network message paths должны учитывать source suppression с момента включения карточки, даже в режимах v1–v3. Отзыв/исправление/delete инвалидируют pending chat/events и caches до нового send; это часть законченного local slice, не отложенный privacy fix.
4. Приёмка: create→restart, CAS conflict, одинаковый/конфликтный command replay, schema1→2/failure/future-version, reset/late callback, источники failed append, quoted/model-only no-confirm и фактическое отсутствие удалённых source pairs во всех projections. Продуктовые тесты не используют сеть.

### MEM-I02 — long-history recall и v4 client

Зависит от MEM-I01; реализация клиента на fake transport может идти параллельно MEM-I03. Обязательные источники: Memory §10.4–10.5, wire §6, AI events §2–5 для interlock/previousInitiative/shared counters.

1. Объявить versioned TypeScript wire DTO и общие JSON fixtures `docs/contracts/fixtures/desktop-backend-v4/` до adapter implementation. Сохранить исходные v1/v2/v3 fixtures, 2400 UTF-16/32KiB caps и точный discriminator; расширение local knowledge union не меняет старые serializers.
2. Реализовать indexed bounded search/ranking и независимую v4 projection. Для v1–v3 использовать baseline selection без новых variants; не маскировать event/joke под dialogue и не терять два допустимых baseline slots.
3. Main явно конфигурирует chat4 + event3; один event interlock/request control, прежние event budgets/enable flag, touch1 и text-only event response. V4 chat передаёт optional previousInitiative с прежней once-only/60s семантикой. 404/unsupported/network failure не меняет версию и не порождает второй запрос.
4. Приёмка selected-context fixtures §10.5, unique five-query long-history corpus, cap/ties/emoji/byte bounds, suppression после correction, slow read/reset/dispose, отсутствующий index/rebuild. Отдельно v4 follow-up «да/почему?» после social/game, user preemption и отсутствие parallel HTTP/нового event write.

### MEM-I03 — backend v4 projection

Зависит от принятого #65, MEM-I02 DTO/shared fixtures и завершённого восстановления backend [#61](https://github.com/zyzycode/project_wisp/issues/61) → [#63](https://github.com/zyzycode/project_wisp/issues/63)/[#64](https://github.com/zyzycode/project_wisp/issues/64). Scope: существующие Python/FastAPI/httpx/Groq, route/schema/prompt/adapter tests; новый auth/storage/ledger topology не нужен. Обязательные источники: wire §6, v1 §3/§5–6, AI events §4–5 только для v4 follow-up semantics.

1. Добавить exact v4 schemas/route и общий endpoint-aware ledger, untrusted category block, отсутствие event/joke candidates/персональных numeric writes. Один provider call, прежние text/envelope/scalar candidate failure policies; новые данные не попадают в logs/server history.
2. На обеих сторонах один corpus v4: valid event/joke/follow-up, all caps, unknown discriminants/root fields, invalid dates, Unicode, response/error envelopes. Backend отклоняет новую category на v2/v3; v4 не принимает events masquerading as chat. Mixed endpoint requestId даёт conflict без второго provider call/новой квоты.
3. Проверить outage/timeout/disconnect/late settlement, usage-on-error и exact byte bounds на mock httpx. Ни настоящие provider keys, ни платные интеграционные вызовы не входят в automatic gate.

### Поставка и проверки реализации

MEM-I01 можно выпускать локально с прежним cloud mode. MEM-I02 default/mode не переключать на v4, пока MEM-I03 не прошёл общий corpus; затем явная доверенная конфигурация chat4/event3 включает расширение. #62–64 продолжают свой текущий v1/v2/v3 scope без обязательного v4; их завершение не означает готовность этого расширения. При откате binary, не знающий schema2, сохраняет файл и использует safe volatile fallback по Memory §4.

Для каждого desktop implementation slice: адресные проверки, затем `node scripts/wisp.mjs typecheck` → `node scripts/wisp.mjs test:frontend`. Для backend: `node scripts/wisp.mjs check:backend` → `node scripts/wisp.mjs test:backend`; интеграция обеих частей дополнительно `node scripts/wisp.mjs test`. Windows smoke: подтверждение/исправление/удаление карточки, restart, offline, отзыв во время запроса. `npm run build` не запускать. Проверки реального текста LLM/операторского доступа не заменяют deterministic projection acceptance.

**CHANGES:** Memory planned §10, небольшой cross-reference local-only Character registry, planned wire §6 и этот результат.

**BOUNDARIES:** runtime/ports/fixtures/dependencies не менялись; schema1 и протоколы v1–v3 действуют как прежде. Нет server history/sync, scheduler/напоминаний, фонового LLM или learning из шуток/событий. UI ограничен future slice карточки памяти; произвольный редактор личности не вводится.

**SPRITES:** none.

**VERIFICATION:** PASS: 41 локальная ссылка с anchors, consistency source ownership/versions/budgets/retention/rollout, лимит ≤450 строк (Memory 290, wire 90, result 63), `git diff --check`. Typecheck/schema validation/product tests/build — NOT RUN: docs-only architect scope, порты/DTO/Python schemas не менялись.

**RECOMMENDED NEXT GATE:** done; implementation — отдельные MEM-I01–MEM-I03.
