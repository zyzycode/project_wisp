# .agents/tasks/README.md — компактная доска задач Project Wisp

Этот файл больше не является полной базой задач. Он хранит только ближайший рабочий фронт и правила передачи задач агентам.

`ROADMAP.md` отвечает на вопрос: куда идём.
Этот файл отвечает на вопрос: что делать следующим.

## Бюджет контекста

- Держать файл коротким: целевой размер — до 180 строк.
- Не расписывать будущие фазы детально заранее.
- Активными держать только текущую фазу и ближайшие 3-7 задач.
- Когда фаза закрыта, переносить детали в краткую строку `done`, а не хранить полные критерии приёмки.
- Агенту в prompt передаётся одна карточка задачи, а не весь backlog.
- Если задаче нужны подробности контракта, агент читает только релевантный `docs/engine/*.md`.

## Статусы

- `planned` — задача понятна, но ещё не готова к выдаче.
- `ready` — можно выдавать owner-agent.
- `in_progress` — задача выполняется.
- `blocked` — нужен внешний ответ или решение.
- `done` — результат принят.

## Текущее состояние

- Phase 0-8: `done` — база проекта, Electron shell, desktop overlay, drag/positioning, rendering, animation FSM, basic behavior, interaction, local chat UI.
- Phase 9: `done` — provider/intent contracts описаны и прошли docs review.
- Phase 10 (Mock AI & Dialogue Loop):
  - `P10-T01` (IAIProvider port & DTO): `done`
  - `P10-T02` (Local MockAIProvider implementation): `done`
  - `P10-T04` (MockAI scenarios & intent mapping tests): `done`
- Текущая задача: `P10-T03` (Связать dialogue loop в UI).
- Следующие шаги: `P10-G01` (Code Review Phase 10) -> Phase 11 (Character Engine v2).

## Активная очередь

### P10-T03 — Связать dialogue loop в клиенте

- **Статус:** `ready`
- **Исполнитель:** `mock-ai-provider` (или `ui-specialist`)
- **Зависит от:** `P10-T02`, `P10-T04`
- **Цель:** связать отправку сообщения в ChatInput -> асинхронный вызов IAIProvider -> thinking state -> маппинг в BehaviorIntent -> отображение реплики в SpeechBubble и запуск соответствующей анимации Wisp.
- **Читать:** `docs/engine/AI_PROVIDER_CONTRACT.md`, `docs/engine/BEHAVIOR_INTENTS.md`, `tests/application/mock-ai-dialogue-scenarios.test.ts`, `src/renderer/components/DesktopPet.tsx`.
- **Менять:** `src/renderer/components/DesktopPet.tsx` (и при необходимости сопутствующие хуки/сервисы диалога).
- **Критерии приёмки:** при вводе фразы Wisp переходит в thinking, затем SpeechBubble показывает ответ провайдера, а FSM запускает анимацию (react_happy, react_confused, respond, sleep и т.д.); unit тесты и typecheck зелёные.
- **Вне скоупа:** backend, реальная LLM сеть, SQLite память.

### P10-G01 — Ревью MockAI implementation

- **Статус:** `planned`
- **Исполнитель:** `code-reviewer`
- **Зависит от:** `P10-T03`
- **Цель:** отревьюить изменения Phase 10 на boundary leaks, отсутствие внешних LLM SDK и корректность intent mapping.
- **Читать:** изменённые файлы Phase 10 и релевантные contracts.
- **Менять:** ничего.
- **Критерии приёмки:** замечания или явное approval; отсутствие backend/SDK leakage.
- **Вне скоупа:** fixes и новые features.

### P10-G02 — Исправить confirmed MockAI findings

- **Статус:** `planned`
- **Исполнитель:** `fixer`
- **Зависит от:** `P10-G01`
- **Цель:** исправить только подтверждённые замечания reviewer.
- **Читать:** reviewer findings и названные файлы.
- **Менять:** только файлы из findings.
- **Критерии приёмки:** findings resolved или явно rejected с причиной.
- **Вне скоупа:** expanding Phase 10.

## Поздние фазы

Раскрывать фазу в карточки задач только тогда, когда она становится следующей активной фазой.

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

## Шаблон карточки задачи

```markdown
Цель:
<один конкретный результат>

Контекст:
<roadmap phase + только релевантные docs/files>

Исполнитель:
<одна роль агента>

Ограничения:
- <границы слоя>
- <запрещённые области>

Критерии приёмки:
- [ ] <проверяемый результат>
- [ ] <verification>

Вне скоупа:
<что задача точно не делает>
```
