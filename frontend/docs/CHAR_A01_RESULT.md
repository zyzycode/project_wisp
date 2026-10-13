# ARCHITECT RESULT — CHAR-A01

**TASK:** [#66](https://github.com/zyzycode/project_wisp/issues/66), 2026-10-13. Desktop: следующий небольшой набор preference learning поверх закрытых #57/#59. Архитектурный gate; новая адаптация ещё не реализована.

## Decision

Добавить `activity.explore` и `activity.social_bid`: явные подтверждённые предпочтения пользователя постепенно меняют веса двух существующих локальных занятий. Один общий learning gate и прежняя формула #57 ограничивают скорость независимо от числа ключей; новые structured facts/tracks остаются локальными. Это наблюдаемое изменение поведения без нового движка, настройки личности или расширения отношений.

Для consumer разрешено расхождение старого Autonomy §7–8 (argmax/clamp до 1, RNG как будущее) с действующим `AUTO-I12-v2`: принят существующий weighted selector с явным RNG. Основание — [AUTO-A09 result, последствия #47](archive/AUTO_A09_RESULT.md#implementation-consequences), цель разнообразия/мягкого repetition в [#47](https://github.com/zyzycode/project_wisp/issues/47), [подтверждённое завершение](https://github.com/zyzycode/project_wisp/issues/47#issuecomment-5566779824) и [local-activity-policy.ts](../src/domain/behavior/local-activity-policy.ts). Weighted выбор сохраняет возможность каждого допустимого положительного веса, тогда как argmax превращал бы малый preference bias в постоянную победу одного семейства; принятие текущего алгоритма не требует runtime cutover. P0–P3 и hard gates не участвуют в этом выборе, межслойные owners сохраняются.

## CHANGES / Layer boundaries & Contracts

- [Character §9.1](engine/CHARACTER_ENGINE.md#91-char-a01-следующий-локальный-набор-предпочтений) — canonical конечные keys/grammar/evidence, общий темп, dedup, multiplier, persistence/projection и проверяемые парные сценарии. §9 отмечает уже реализованный cursor consumer.
- [Autonomy §5, §7–9, §11](engine/AUTONOMY_ENGINE.md#7-scoring-и-arbitration) — разрешённая validated projection, weighted baseline, RNG/trace и проверяемость. Это согласование существующей политики плюс явно помеченный целевой multiplier.
- [Memory §9](engine/MEMORY_ENGINE.md#9-p15-a02-явные-знания-и-простой-recall) — ссылка на local-only registry extension согласована с параллельным MEM-A03; каноническая grammar остаётся в Character. Memory/Character snapshot v1 уже допускают эти записи, migration не нужна.
- Новые code types/IPC/wire DTO в этом gate не объявлялись. Будущее расширение `VerifiedPreferenceEvidence` и `CharacterAutonomySnapshot` остаётся внутри существующей local boundary; provider-neutral/wire allowlists v1–v3 сохраняются. Backend не получает новых numerical authorities.

## Implementation consequences

### CHAR-I01 — отдельная задача app-developer после #66

Обязательные источники: весь этот результат; Character §2.1–2.2/§3/§5/§7/§9–9.1/§11; Autonomy §5–8/§13–14; Memory §2 (`user_facts`, `character_state`), §4/§6 и §9 (validation/ordering/projection); [P15-M05 result](archive/P15_M05_RESULT.md); [cursor consumer §6](../../docs/contracts/AI_EVENTS_CONTRACT.md#6-learned-preference-влияет-на-локальный-выбор-59). Roadmap §1–2 — продуктовый источник, не runtime контракт.

1. До сервисов расширить существующий [evidence port](../src/application/ports/memory-knowledge.interface.ts) конечным local union и внутренний [autonomy snapshot](../src/domain/character/autonomy-character-engine.ts). Local fact type отделить от provider `MemoryFactKey`/`AIProviderMemoryContext`: слепое расширение их union нарушит неизменный wire. Не добавлять public IPC/новый `BehaviorIntentKind`.
2. В [registry](../src/application/services/memory-fact-registry.ts) и [MemoryKnowledge](../src/application/services/memory-knowledge.ts) реализовать только две grammar строки и mapping persisted fact → evidence. Использовать существующие history queue/source/generation checks, без нового extraction call/очереди. В [recall](../src/application/services/memory-recall.ts) сохранить provider allowlist до caps и исключение новых fact-пар из episodes.
3. Обобщить ограниченный reducer [preferences.ts](../src/domain/character/preferences.ts) и [CharacterStateService](../src/application/services/character-state.service.ts), сохранив одну общую eligibility и source дедупликацию. Existing `trackPreference` не заменяет evidence policy. Snapshot/checkpoint/reset путь остаётся прежним; preference callback не вызывает rewards.
4. Main проецирует два validated tracks в existing snapshot; [local selector](../src/domain/behavior/local-activity-policy.ts) применяет multiplier, расширяет внутренний trace и tuning version. Точное правило — Character §9.1, численные baseline factors/каталог/одно RNG потребление сохраняются. Не изменять курсорный bias, routes, Activities или presentation.
5. Адресные tests: весь Character §9.1 acceptance matrix, в том числе actual service→snapshot→consumer, реальная SQLite checkpoint/restart/reset, общий gate при чередовании всех трёх keys, repeat source после cooldown/eviction, mixed like/dislike, finite/range validation, restore старого snapshot без новых keys. Для integrated SocialBid обеспечить текущие Main attention/friendship gates и свободный budget; недостаточно принудительно поставить `canSocial=true` в чистом unit test.
6. Проверить неизменность serialized v1–v3 fixtures/allowlists и запрет новых structured keys в wire; отсутствие новых source pairs в recall; провал append/upsert, reset/dispose и поздний callback. Quiet/sleep/consent/game-effect regressions обязательны. Сеть мокать, paid calls не нужны.
7. Финальный gate реализации: `node scripts/wisp.mjs typecheck`, затем `node scripts/wisp.mjs test:frontend`, `git diff --check`. Build запрещён. Ручная Windows-проверка уместности инициатив — отдельная приёмка, не замена этих tests.

Внешний backend/новый memory index/#65 не блокируют этот локальный slice: исходные facts/snapshot/consumer уже существуют. Если реализация начнётся одновременно с MEM-I01, согласовать владение общими registry/recall/ports; новые shared jokes/events не использовать как shortcut evidence. Создание и ID CHAR-I01 — менеджер; здесь зафиксирован implementation scope, а не уже заведённая Issue.

**BOUNDARIES:** docs-only; новый source composition остаётся локальным, Domain принимает только validated semantic evidence. Нет новых dependencies, subsystem, LLM training, типов отношений, runtime/схем/fixtures, изменений ассетов или внешних scopes. Серверный перенос v1–v3 не расширяется.

**SPRITES:** none; используются существующие Explore/SocialBid семейства и fallbacks.

**VERIFICATION:** PASS — локальные ссылки/anchors трёх изменённых документов, согласованность evidence→persist→Domain→consumer, расчёт парных weight/RNG сценариев, лимит 450 строк, `git diff --check` по scope. Runtime/product tests, typecheck и Windows smoke — NOT RUN: архитектурный docs-only gate, code types не изменены. Новые сценарии заданы для реализации, их runtime-прохождение здесь не заявляется.

**RECOMMENDED NEXT GATE:** done для #66; отдельный app-developer CHAR-I01 реализует целевой контракт.
