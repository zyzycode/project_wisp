# Codex Agents — карта ролей

Документы ролей нужны для удержания малого контекста, а не для бюрократии. Каждый агент читает только task card, эту карту ролей и файлы, явно нужные для его scope.

## Routing

1. `project-manager` ограничивает scope, держит `ROADMAP.md` и `.agents/tasks/README.md` компактными, затем назначает одного owner.
2. `architect` подключается для изменений layer boundaries, IPC, ports, `docs/engine/*` и provider/render/behavior contracts.
3. Feature agent реализует один слой или один небольшой vertical slice.
4. `code-reviewer` ревьюит changed files и возвращает findings.
5. `fixer` исправляет только confirmed findings.
6. `tester` проверяет acceptance criteria перед закрытием задачи Project Manager-ом.

## Роли

| Роль | Зона владения | Пишет код | Запускает тесты |
|---|---|---:|---:|
| `project-manager` | scope, task cards, docs routing, status | нет | нет product tests |
| `architect` | contracts, boundaries, architecture docs | обычно нет | только при необходимости |
| `ui-specialist` | Renderer UI, render engine, CSS, settings UI | да | да |
| `electron-platform` | Main/Preload, windows, IPC, OS adapters | да | да |
| `domain-behavior` | character rules, behavior FSM, animation FSM | да | да |
| `data-memory` | SQLite, repositories, migrations, local persistence | да | да |
| `mock-ai-provider` | `IAIProvider`, `MockAIProvider`, provider DTOs | да | да |
| `code-reviewer` | risks, regressions, missing tests | нет | опционально |
| `fixer` | confirmed review findings | да | да |
| `tester` | verification and test coverage | tests only when assigned | да |

## Правила контекста

- Начинать с `AGENTS.md`, этого файла и assigned task card.
- Читать `ARCHITECTURE.md` только для architecture-affecting work.
- Читать `docs/engine/*.md` только если task card называет этот contract.
- Читать `.agents/rules/*.md` только для слоя, который меняется.
- Не читать все role, workflow, skill и rule docs по умолчанию.
- Не копировать целые roadmap sections в prompts агентов; передавать одну task card.

## Выбор owner

- Product/task docs: `project-manager`.
- Public contracts, ports, IPC, provider/render/behavior boundaries: `architect`.
- React components, visual state, CSS, speech bubble, chat UI, settings UI: `ui-specialist`.
- Electron windows, tray, autostart, click-through, Linux X11/Wayland, preload и IPC: `electron-platform`.
- Mood, energy, sleep, autonomous behavior, FSM transitions, animation intent selection: `domain-behavior`.
- SQLite, memory, settings persistence, migrations: `data-memory`.
- Mock replies, provider DTOs, thinking/error/fallback state: `mock-ai-provider`.
- Independent code review: `code-reviewer`.
- Confirmed fixes: `fixer`.
- Acceptance verification: `tester`.

## Review modes

Общий `code-reviewer` выбирает фокус по изменённым файлам:

- `ui`: Renderer isolation и отсутствие business logic в React.
- `platform`: Electron security, preload, IPC, OS adapters.
- `domain`: behavior/animation rules и pure domain logic.
- `data`: persistence, privacy, migrations.
- `provider`: provider boundaries и отсутствие backend/SDK leakage.
- `docs`: markdown consistency и scope control.

Architect review обязателен перед изменением public contracts, `docs/engine/*`, IPC, ports, provider boundaries, render/animation/behavior boundaries или layer ownership.
