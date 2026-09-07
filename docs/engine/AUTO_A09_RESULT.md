# ARCHITECT RESULT — AUTO-A09

TASK: [#45](https://github.com/zyzycode/project_wisp/issues/45) — локальная автономность, feedback и AI priority.

Статус: подготовлено для `reviewer`; принятие gate и закрытие Issue ещё не выполнены.
Это целевой контракт. Runtime дефекты исправляются в dependent Issues после принятия gate.

## Decision

Сохранён единый Brain → Body → Skin и Character/Activity/Motion ownership.
Допустимый AI получает P3 ownership выше local реакций/занятий, но ниже P0/P1/P2,
с конечными admission/execution deadlines и безопасным deferred interruption.
Feedback зависит от фактической semantic execution; quiet — устойчивый session mode.

## CHANGES / Layer boundaries & Contracts

- [Autonomy](./AUTONOMY_ENGINE.md): source priority, admission, deadlines, no-resume,
  локальные семейства, opportunity coalescing, общий initiative budget и versioned tuning.
- [Activity](./ACTIVITY_ENGINE.md): request/start/outcome, semantic dedup, Explore/игра,
  drag/landing и terminal transaction.
- [Character](./CHARACTER_ENGINE.md): quiet, outcome deltas и bounded recovery без смены thresholds.
- [Behavior intents](./BEHAVIOR_INTENTS.md), [Perception](./PERCEPTION_ENGINE.md),
  [UI](./UI_SPEC.md): только согласование kinds, bounded approach и quiet bridge.
- [Admission port](../../src/application/ports/behavior-admission-port.ts): provider offer/receipt,
  ownership, lifecycle events, admission boundary, tuning и budget snapshot.
- [Feedback port](../../src/application/ports/shimeji-feedback-port.ts): target outcome и mapper input.
- [Shared DTO](../../src/shared/ipc-contracts.ts): target quiet command, bridge и полный snapshot.

BOUNDARIES: только типы и спецификации. Нет runtime, новых dependencies, provider SDK,
UI implementation, persistence, изменений Motion/Renderer owners или внешних scopes.
Новых `BehaviorIntentKind` нет: calm=`idle`, Explore=`wander`, cursor/SocialBid/game=`play`.
Target interfaces рядом с текущими declarations обеспечивают компиляцию без ложной runtime
поддержки; implementation выполняет атомарный cutover и удаляет transitional declarations.

## Implementation consequences

| Issue | Обязательная реализация и контроль |
|---|---|
| [#46](https://github.com/zyzycode/project_wisp/issues/46) | Сначала regression rejected play; единый terminal mapper вместо legacy Swat, run/effect dedup, Explore/game deltas, drag/landing, bounded Needs catch-up. Обновлять реальный CharacterStateService перед следующим gate. |
| [#47](https://github.com/zyzycode/project_wisp/issues/47) | Utility по Needs/personality/environment/history, calm/game catalog, semantic pose и gait до Motion/Skin, bounded trace. Не создавать второй scheduler. |
| [#48](https://github.com/zyzycode/project_wisp/issues/48) | Сохранить stationary Observe Cursor; одна bounded same-support approach цель, freshness/dwell, общий budget и game outcome. |
| [#49](https://github.com/zyzycode/project_wisp/issues/49) | Невербальный SocialBid и bounded wait без штрафа за ignore; общий budget, typed quiet command + exact validation + full state, без очереди после resume. |
| [#50](https://github.com/zyzycode/project_wisp/issues/50) | Заменить boolean/busy rejection Activity на admission boundary; перенести offer metadata из DialogueRuntime, сериализовать start/terminal, generation/TTL/dedup, сохранить single-flight до settlement. |

Последовательность: #46 → #47 → (#48, #49) → #50.
Общий initiative budget вводится в #48 как один переиспользуемый механизм, #49 подключает
SocialBid к тому же состоянию. Зависимость #49 от готового #48 для parallel реализации
не обязательна: совместимый контракт budget уже здесь, дублировать ledger запрещено.
В #50 `DialogueRuntimeOptions.offerIntent` переходит на target offer/receipt;
`beginThinking/endThinking` остаются presentation-only. Старый executor не сохраняется параллельно.

Обязательные правила: source order, gates, once-only, finite bounds, no resume/backlog,
single-flight, Main validation и отсутствие business logic в Renderer.
Tuning: численные deltas, длительности, веса, budget capacity; начальные значения указаны
в Character §11 / Autonomy §14. Изменения документировать с deterministic scenario,
Character sleep/wake thresholds этим разрешением не меняются.

## Acceptance matrix для разработчика

- AI во время Explore/calm/game/optional Rest: immediate или bounded safe defer;
  completion/cancel/expiry возвращает один local flow.
- Новый user/physics/P2, stale generation/target, duplicate, quiet и disable:
  нет повторного start/feedback и восстановления старого маршрута.
- Timeout/offline/reset/reload/dispose, late promise settlement: локальная жизнь продолжается,
  provider busy не снимается до settlement, retired reply не применяется.
- Rejected/accepted-not-started/cancelled-before-play/completed-play: разные последствия;
  duplicate eventId и новый ID того же run не удваивают reward.
- Quiet, nap/full sleep, wake, cursor stale/fast/lost и ignored SocialBid:
  gates соблюдаются, physics не задерживается, нет guilt или бесконечной погони.

SPRITES: none.

VERIFICATION: `npm run typecheck` — PASS. Локальные Markdown targets, регистр и anchors — PASS;
затронутые engine specs укладываются в 450 строк; `git diff --check` — PASS.
Продуктовые тесты и OS smoke — NOT RUN: архитектурный gate без runtime-изменений;
их выполняют разработчики #46–#50.

RECOMMENDED NEXT GATE: `reviewer`.
