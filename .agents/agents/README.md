# Codex Agents — базовые роли

Роли нужны для малого контекста, а не для бюрократии. В Project Wisp используются специализированные роли; детализация по слоям живёт в `.agents/rules/*.md` и `docs/engine/*.md`.

Эта карта относится к desktop-приложению. Подготовка изображений имеет [отдельный скоуп и локального агента](../../asset-pipeline/README.md); материалы генерации не входят в контекст ролей ниже.

## Роли

| Роль | Зона владения | Пишет код | Запускает проверки |
|---|---|---:|---:|
| `project-manager` | scope, roadmap, backlog, docs routing | нет | docs consistency |
| `architect` | layer boundaries, IPC/ports, engine contracts | обычно нет | при необходимости |
| `app-developer` | desktop implementation: Main, Preload, Renderer, platform, persistence/provider adapters | да | да |
| `domain-behavior` | character engine, behavior FSM, animation FSM, pure domain rules | да | да |
| `reviewer` | review, verification, test strategy, regression checks | tests only when assigned | да |

## Выбор роли

- Product/task docs, roadmap/backlog sequencing: `project-manager`.
- Public contracts, ports, IPC, provider/render/behavior boundaries: `architect`.
- Main/Preload, Renderer UI & infrastructure, platform adapters, SQLite, settings UI, `MockAIProvider`: `app-developer`.
- `SynthesizedEmotionalTone`, needs, relationship rules, sleep/quiet, autonomous behavior, FSM transitions, animation intents: `domain-behavior`.
- Diff review, test gate, verification strategy, regression checks: `reviewer`.

Confirmed findings возвращаются текущему owner-агенту (`app-developer` или `domain-behavior`) как fix-pass. Reviewer не чинит код в том же review-pass.

## Правила контекста

- Начинать с `AGENTS.md`, этой карты ролей и назначенной GitHub Issue.
- Проверять архитектурные границы по `.agents/rules/10-architecture.md`; человеческий обзор не входит в обязательный контекст.
- Читать `docs/engine/*.md` только если Issue называет этот contract.
- Читать `.agents/rules/*.md` только для слоя, который меняется.
- Не читать все role, workflow, skill и rule docs по умолчанию.
- Не копировать целые разделы roadmap в prompts агентов; передавать одну GitHub Issue.

## Review Modes

`reviewer` выбирает фокус по изменённым файлам:

- `ui`: Renderer isolation и отсутствие business logic в React.
- `platform`: Electron security, preload, IPC, OS adapters.
- `domain`: behavior/animation rules и pure domain logic.
- `data`: persistence, privacy, migrations.
- `provider`: provider boundaries и отсутствие backend/SDK leakage.
- `docs`: markdown consistency и scope control.

Architect review обязателен перед изменением public contracts, `docs/engine/*`, IPC, ports, provider boundaries, render/animation/behavior boundaries или layer ownership.

## Общий формат отчёта

```markdown
TASK
- Task ID:
- Scope:

CHANGES
- Что изменено.

BOUNDARIES
- Как сохранены ограничения слоя и hard constraints.

VERIFICATION
- typecheck/lint/tests/build/smoke или причина NOT RUN.

RECOMMENDED NEXT GATE
- `reviewer` / `architect` / `blocked` / `done`
```
