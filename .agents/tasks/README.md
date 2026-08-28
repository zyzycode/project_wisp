# .agents/tasks/README.md — компактная доска задач Project Wisp

Этот файл больше не является полной базой задач. Он хранит только ближайший рабочий фронт и правила передачи задач агентам.

`ROADMAP.md` отвечает на вопрос: куда идём.
Этот файл отвечает на вопрос: что делать следующим.

## Бюджет контекста

- Держать файл коротким: целевой размер — до 180 строк.
- Не расписывать будущие фазы детально заранее.
- Активными держать только текущую фазу и ближайшие 3-7 задач.
- Когда фаза закрыта, переносить детали в краткую строку `done`, а не хранить полные acceptance criteria.
- Агенту в prompt передаётся одна task card, а не весь backlog.
- Если задаче нужны подробности контракта, агент читает только релевантный `docs/engine/*.md`.

## Статусы

- `planned` — задача понятна, но ещё не готова к выдаче.
- `ready` — можно выдавать owner-agent.
- `in_progress` — задача выполняется.
- `blocked` — нужен внешний ответ или решение.
- `done` — результат принят.

## Текущее состояние

- Phase 0-8: `done` — база проекта, Electron shell, desktop overlay, drag/positioning, rendering, animation FSM, basic behavior, interaction, local chat UI.
- Phase 9: `review` — provider/intent contracts уже описаны, нужен docs review gate.
- Текущий gate: `P09-G01`.
- Следующая implementation phase: Phase 10 — Mock AI & Dialogue Loop.

## Активная очередь

### P09-G01 — Ревью provider/intent docs

- **Статус:** `ready`
- **Исполнитель:** `code-reviewer`
- **Зависит от:** `P09-T01`-`P09-T04`
- **Цель:** проверить Phase 9 markdown contracts на противоречия.
- **Читать:** `AGENTS.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `docs/engine/README.md`, `docs/engine/AI_PROVIDER_CONTRACT.md`, `docs/engine/BEHAVIOR_INTENTS.md`, `docs/engine/ANIMATION_ENGINE.md`.
- **Менять:** ничего, если явно не попросят.
- **Критерии приёмки:** список findings или явное "findings нет"; без product-code edits.
- **Вне скоупа:** implementation, tests, fixing docs.

### P10-T01 — Добавить `IAIProvider` port и DTO

- **Статус:** `planned`
- **Исполнитель:** `mock-ai-provider`
- **Зависит от:** `P09-G01`
- **Цель:** добавить typed provider boundary для локального MockAI.
- **Читать:** `docs/engine/AI_PROVIDER_CONTRACT.md`, `docs/engine/BEHAVIOR_INTENTS.md`.
- **Менять:** только application/shared provider types.
- **Критерии приёмки:** нет external AI SDK types; DTO не зависит от UI; errors/thinking/latency типизированы.
- **Вне скоупа:** network calls, backend/proxy, UI redesign.

### P10-T02 — Реализовать локальный `MockAIProvider`

- **Статус:** `planned`
- **Исполнитель:** `mock-ai-provider`
- **Зависит от:** `P10-T01`
- **Цель:** генерировать offline Wisp replies по простым локальным категориям.
- **Читать:** provider contract и файлы, изменённые в `P10-T01`.
- **Менять:** mock provider implementation и local response catalog.
- **Критерии приёмки:** категории greeting/question/care/play/sleep/fallback; simulated latency; no network.
- **Вне скоупа:** memory extraction, real LLM, external backend.

### P10-T03 — Связать dialogue loop

- **Статус:** `planned`
- **Исполнитель:** `mock-ai-provider`
- **Зависит от:** `P10-T02`
- **Цель:** связать user message -> provider response -> intent mapper -> presentation state.
- **Читать:** provider contract, behavior intents, текущие chat UI boundaries.
- **Менять:** dialogue application flow и typed state handoff.
- **Критерии приёмки:** UI не знает concrete provider; thinking/reply flow виден; provider response мапится в `BehaviorIntent`.
- **Вне скоупа:** settings window, memory, backend.

### P10-T04 — Проверить MockAI scenarios

- **Статус:** `planned`
- **Исполнитель:** `tester`
- **Зависит от:** `P10-T03`
- **Цель:** проверить provider categories, fallback и thinking flow.
- **Читать:** изменённые Phase 10 files и релевантные contracts.
- **Менять:** только focused tests.
- **Критерии приёмки:** покрыты greeting/question/sleep/unknown paths; provider не управляет UI напрямую.
- **Вне скоупа:** visual regression, packaging, real network.

### P10-G01 — Ревью MockAI implementation

- **Статус:** `planned`
- **Исполнитель:** `code-reviewer`
- **Зависит от:** `P10-T04`
- **Цель:** отревьюить Phase 10 changes на boundary leaks и missing tests.
- **Читать:** изменённые Phase 10 files и релевантные contracts.
- **Менять:** ничего, если явно не попросят.
- **Критерии приёмки:** findings или clear approval; backend/SDK leakage checked.
- **Вне скоупа:** fixes and new features.

### P10-G02 — Исправить confirmed MockAI findings

- **Статус:** `planned`
- **Исполнитель:** `fixer`
- **Зависит от:** `P10-G01`
- **Цель:** исправить только confirmed reviewer findings.
- **Читать:** reviewer findings и файлы, названные в findings.
- **Менять:** только files named in findings.
- **Критерии приёмки:** findings resolved или явно rejected с причиной.
- **Вне скоупа:** expanding Phase 10.

## Поздние фазы

Раскрывать фазу в task cards только тогда, когда она становится следующей активной фазой.

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 11 | Character Engine v2: traits, mood, energy, needs, stimuli | `domain-behavior` |
| 12 | Animation & Reaction Pack: richer reactions, idle variety, sleep/wake rules | `domain-behavior` |
| 13 | Render Engine & Asset Pipeline: sprite sheets, layers, props, themes | `ui-specialist` |
| 14 | Offline Memory & Relationship: SQLite memory, facts, history, clear memory | `data-memory` |
| 15 | Desktop Life Behaviors: quiet mode, cooldowns, habits | `domain-behavior` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, debug UI | `ui-specialist` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `mock-ai-provider` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `tester` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `electron-platform` |

## Шаблон task card

```markdown
Goal / Цель:
<один конкретный результат>

Context / Контекст:
<roadmap phase + только релевантные docs/files>

Owner / Исполнитель:
<одна роль агента>

Constraints:
- <границы слоя>
- <запрещённые области>

Критерии приёмки:
- [ ] <проверяемый результат>
- [ ] <verification>

Вне скоупа:
<что задача точно не делает>
```

## Правило PM

Project Manager не просит агентов читать каждый `.md` файл. PM берёт одну task card, добавляет только нужные ссылки и обновляет эту доску после принятия результата.
