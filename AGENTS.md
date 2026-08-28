# AGENTS.md — рабочие правила Project Wisp

Этот файл — верхнеуровневое руководство для агентов и разработчиков. Он должен оставаться коротким; подробные карточки задач живут в `.agents/tasks/README.md`, а стабильные контракты движков — в `docs/engine/*.md`.

## Продукт

Project Wisp — кроссплатформенный desktop AI-компаньон в духе desktop pets: один персонаж живёт на рабочем столе, двигается, реагирует, выражает эмоции, помнит локально и может общаться.

Обещание пользователю: скачал, установил, Wisp ожил. Пользователь не должен регистрироваться у AI-провайдеров, вставлять API-ключи, понимать токены/модели, запускать локальные серверы или заниматься администрированием.

## Текущий скоуп

Репозиторий — desktop-first и offline-first MVP.

- Целевые платформы: Linux, Windows, macOS.
- Базовая среда разработки: Ubuntu Linux.
- Стек приложения: Electron, TypeScript strict mode, React, Zustand, typed IPC.
- AI-слой: граница `IAIProvider`, текущая реализация — локальный `MockAIProvider`.
- Хранение данных: локальный SQLite за Main-process репозиториями, когда начнутся память и настройки.

## Жёсткие ограничения

- Никакого backend/proxy/server кода в `project_wisp`.
- Никаких официальных внешних AI SDK в desktop-клиенте.
- Никаких пользовательских AI API-ключей.
- Никакой server-side auth/billing логики.
- Никаких лишних npm-зависимостей.
- Никакого нецелевого рефакторинга.
- Domain и Application остаются платформонезависимыми.
- OS-specific поведение живёт за platform adapters.
- Renderer не имеет доступа к Node.js и не знает детали storage, provider или OS.

## Архитектура кратко

Поток:

```text
Renderer UI -> typed preload/IPC -> Application use cases -> Domain -> Ports <- Infrastructure adapters
```

Владение:

- Main process: окна, IPC handlers, application use cases, domain orchestration, persistence adapters.
- Preload: минимальный typed `window.wispAPI` bridge с `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer: только React UI и presentation state.
- Domain: чистый TypeScript для поведения, анимаций и правил персонажа.
- Provider: возвращает semantic response DTO; он не управляет React, DOM, CSS, assets или animation frames.

## Бюджет контекста

Агенты не читают весь markdown "на всякий случай".

Минимум для большинства задач:

- `AGENTS.md`;
- одна task card из `.agents/tasks/README.md`;
- только source docs, названные в task card;
- только code files, нужные для задачи.

`ARCHITECTURE.md` читать только для задач, которые меняют или проверяют архитектурные границы. `docs/engine/*.md` читать только если задача касается этого engine contract. `.agents/rules/*.md` читать только для релевантного слоя.

Целевой размер markdown:

- `AGENTS.md`: до 120 строк.
- `ROADMAP.md`: до 140 строк.
- `.agents/tasks/README.md`: до 180 строк.
- Не дублировать task-level детали между roadmap и backlog.

## Роли агентов

Карта ролей находится в `.agents/agents/README.md`.

- `project-manager`: scope, routing задач, roadmap/backlog docs. Не меняет product-code.
- `architect`: границы слоёв, IPC/ports, engine contracts, `docs/engine/*`.
- `ui-specialist`: Renderer UI, render engine, visual state, settings UI.
- `electron-platform`: Main/Preload, окна, IPC, OS adapters.
- `domain-behavior`: character engine, behavior FSM, animation FSM.
- `data-memory`: SQLite, repositories, migrations, локальная память/settings persistence.
- `mock-ai-provider`: `IAIProvider`, `MockAIProvider`, provider DTO handling.
- `code-reviewer`: только review, findings first, без fixes.
- `fixer`: исправляет только подтверждённые findings.
- `tester`: verification, test design и test execution.

## Рабочие правила

Перед правками определить touched files и короткий план. Делать самый маленький vertical slice, который закрывает задачу. Использовать существующие абстракции. Сохранять cross-platform boundaries. Не менять unrelated files и не откатывать чужие изменения.

Проверка:

- Изменения product-code требуют подходящие typecheck/lint/tests.
- Docs-only changes требуют markdown/diff consistency review.
- Project Manager не запускает product tests для обычной docs planning работы.

## Формат задачи

```markdown
Goal / Цель:
<один конкретный результат>

Context / Контекст:
<phase + только релевантные docs/files>

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
