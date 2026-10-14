# REM-A01 — ARCHITECT RESULT

**TASK:** [#68 — обещания и локальные напоминания](https://github.com/zyzycode/project_wisp/issues/68), frontend architecture, 2026-10-14.

## Decision

Минимальный сценарий — локальная форма дела и фиксированного срока, preview, явное подтверждение, durable запись и один автоматический banner с доступной после него карточкой. Свободное пожелание и обещание в ответе модели не создают обязательство: для первого полезного slice не нужны LLM proposal, backend или новые зависимости. Fixed-offset ввод сознательно оставляет IANA/DST resolver на следующий gate; UTC момент не меняется после подтверждения. Delivery — at-most-once автоматическая попытка с возможной потерей banner между commit и показом, а не обещание exactly-once или прочтения.

## CHANGES — Layer boundaries & Contracts

- [Memory §11.1–11.2](engine/MEMORY_ENGINE.md#111-семантика-и-подтверждение): подтверждение, одноразовый trigger, неоднозначность, fixed offset/DST и wall-clock changes.
- [Memory §11.3–11.5](engine/MEMORY_ENGINE.md#113-source-of-truth-schema-и-retention): source of truth, migration3, receipts, clock/scheduler ownership, missed deadline, quiet/sleep/restart, cancel/delete/reset/late callbacks.
- [UI §7](engine/UI_SPEC.md#7-rem-a01-локальные-напоминания-planned): локальный input, typed bridge capabilities, одна Brain projection и честные подписи статусов.

Существующие [memory ports](../src/application/ports/memory-repository.interface.ts), [MemoryScheduler](../src/application/ports/memory-runtime.ts), [schema v1](../src/infrastructure/memory/schema.ts), [lifecycle](../src/application/services/memory-lifecycle.ts), [IPC DTO](../src/shared/ipc-contracts.ts) сверены. Код/типы не изменены: новые порты и exact DTO объявляются первой частью implementation до use cases, adapters и UI. В документах явная маркировка planned, текущий runtime не выдан за готовую возможность.

## Implementation consequences — REM-I01

**Следующая задача:** [REM-I01 #82 — одноразовые локальные напоминания с подтверждением и persistent delivery marker](https://github.com/zyzycode/project_wisp/issues/82) (`app-developer`). **Блокер начала:** [MEM-I01 #80](https://github.com/zyzycode/project_wisp/issues/80) должен реализовать migration2 и её reset/receipt инфраструктуру по [MEM-A03 result](../../docs/MEM_A03_RESULT.md). Не зависит от backend v4, LLM extraction или полного редактора памяти; менять зарезервированную migration2 ради REM запрещено.

Обязательные источники: весь этот результат; [Memory §3–4, §6, §10.3 и §11](engine/MEMORY_ENGINE.md#11-rem-a01-обещания-и-локальные-напоминания-planned); [UI §6.2/6.5 и §7](engine/UI_SPEC.md#7-rem-a01-локальные-напоминания-planned); [Character §2.2](engine/CHARACTER_ENGINE.md#22-устойчивый-quiet-auto-a09) для existing quiet. Соседние AI/wire документы не расширяют scope.

1. Объявить immutable reminder ports/values и typed preview/confirm/list/cancel/delete DTO/results, safe errors и optional reminderNotice. Использовать существующие `MemoryResult`, generation и `MemoryScheduler`; не создавать generic command bus. Обе стороны IPC и private worker protocol валидируются до подключения runtime.
2. Добавить минимальную чистую policy в `frontend/src/domain/reminders/`; calendar arithmetic/eligibility/transitions получают clocks/gates явно. Application coordinator создаёт preview/ID, принимает подтверждение, сериализует mutations, обеспечивает bounded reconcile и invalidation. Этот новый Domain каталог явно одобрен REM-A01; другие подсистемы данным gate не разрешены.
3. Расширить существующий memory adapter/worker additive migration3, repository/CAS/receipts/list, full clear и startup. Schema2 prerequisite остаётся отдельной задачей; не переносить SQL в Main и не создавать второй worker/БД.
4. Подключить единственный coordinator в Main, lifecycle hooks quiet/sleep/dialogue reset/stream replacement/full reset/shutdown, ordered Brain projection и локальную форму/список/notice в существующей UI поверхности. Новые каналы строго typed; отдельный window/OS toast не нужен.
5. Выполнить сценарии ниже с injected clocks и fake timers, подходящие focused тесты, затем `node scripts/wisp.mjs typecheck` и `node scripts/wisp.mjs test:frontend`. Windows ручной restart/suspend/quiet пройти при наличии запуска; если недоступен, честно указать NOT RUN. `npm run build` не запускать.

**Разрешённый scope REM-I01:** `frontend/src/domain/reminders/**`; новые reminder ports/services и точечные memory lifecycle hooks; `frontend/src/infrastructure/memory/**`; нужные Main/Preload/Shared validators/publisher; существующие Renderer dialogue/menu surfaces и reminder components; соответствующие `frontend/tests/**`; уточнения только затронутых canonical контрактов. Без package/lockfile/config/root tooling, backend/wire, внешних календарей, отправки другим людям, OS scheduler, assets и asset-pipeline. Имена конкретных новых файлов исполнитель объявляет до правок; неиспользуемые абстракции не создавать.

### Сценарии приёмки REM-I01

| Сценарий | Проверяемый результат |
|---|---|
| «Напомни потом», цитата обещания, LLM «я напомню», свободный чат | Ноль writes/таймеров; локальная форма требует действие и явные поля срока |
| Valid preview → confirm → повтор того же confirm | Ровно одна durable pending запись; «Сохранено» только после commit; altered payload/expired token/stale stream отклонены |
| Две одинаковые civil даты/часа с offset +02:00 и +01:00 | UTC моменты различаются на час; UI явно fixed-offset, DST не выбирается молча; invalid calendar/offset/прошлый срок отклонены |
| Смена timezone, forward/backward wall jump, monotonic deadline expiry | dueAt immutable; будущий pending пересчитывается; terminal не оживает; banner живёт 10 s monotonic |
| Due при quiet/Character sleep/нет stream; resume или restart через 1 h/25 h | В пределах 24 h только один возможный delayed notice после снятия gate; через 25 h missed без banner; passive запись доступна |
| Две due записи, repeated reconcile/snapshot/reload/restart | Порядок dueAt/id, интервал ≥10 s; отсутствие второго автоматического notice по тому же ID; list не claim-ит |
| Crash после claim commit до publish; ack lost | Banner может быть потерян, карточка announced остаётся; чтение/доставка не заявлены; неизвестный результат не повторяется вслепую |
| Cancel/delete/full reset во время read/claim/confirm; поздний ответ, повтор старого command ID | После успешного commit нет повторного notice/recreate; reset удаляет payload и receipts; epochs/stream/CAS отвергают старый результат |
| Known rollback, worker failure, DB busy, volatile mode, startup timeout | Честный failure, отсутствие ложного save/cancel; Character/input работают; outage не формирует durable backlog |
| Fresh 1→2→3, existing 2→3, migration failure, future schema, reset/restart | Старые rows сохранены, журнал согласован, rollback не повышает version; reset сохраняет схему и удаляет новые таблицы данных |
| 100 pending + ещё одна; большой terminal список; quiet blocked overdue | Bounded limit/list/read; нет spin loop, unbounded queue или burst; новые provider calls отсутствуют |

## BOUNDARIES

Только проектирование desktop. Backend/API/provider context, текущая schema v1 и runtime не изменены. Чистые правила — Domain; use cases/clocks/scheduler — Application с Main composition; SQL — существующий Infrastructure worker; Renderer — ввод/отображение. Новых dependencies нет; Dependency Review не нужен. Arbitrary promises, recurrence/snooze, IANA resolver и online delivery за пределами первого slice.

## SPRITES

none — plain-text карточка использует существующую UI поверхность.

## VERIFICATION

Проверены локальные ссылки, согласованность владения/lifecycle, зависимость migration3 от MEM-I01/schema2, лимит обеих спецификаций ≤450 строк и чистота diff. Typecheck и продуктовые тесты — **NOT RUN: docs-only архитектура, порты/DTO не менялись**. Windows ручная приёмка — **NOT RUN: runtime не реализован**.

## RECOMMENDED NEXT GATE

**done** для REM-A01. **blocked** для REM-I01 до завершения MEM-I01 #80; после него — app-developer в указанном scope, без нового architect gate при соблюдении принятого решения.
